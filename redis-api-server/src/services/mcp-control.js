const crypto = require('crypto');
const {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const { getDdbDoc } = require('./aws/clients');
const { randomToken, sha256Hex } = require('../utils/crypto');

const DEFAULT_TABLE = 'portfolio-mcp-control';
const DEFAULT_READ_LIMIT = 100;
const DEFAULT_DRAFT_MUTATION_LIMIT = 20;
const DEFAULT_APPROVAL_LIMIT = 10;
const AUDIT_TTL_DAYS = 90;
const APPROVAL_TTL_DAYS = 7;
const IDEMPOTENCY_TTL_DAYS = 2;

const ALL_SCOPES = [
  'site:read',
  'content:read',
  'content:write:draft',
  'blog:read',
  'blog:write:draft',
  'blog:propose',
  'media:read',
  'media:write:draft',
  'comments:read',
  'comments:propose',
  'social:read',
  'social:write:draft',
  'social:propose',
];

const DEFAULT_SCOPES = [
  'site:read',
  'content:read',
  'blog:read',
  'blog:write:draft',
  'blog:propose',
  'media:read',
  'comments:read',
  'comments:propose',
  'social:read',
  'social:write:draft',
  'social:propose',
];

function getTableName() {
  return String(process.env.MCP_CONTROL_TABLE_NAME || DEFAULT_TABLE).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function epochSeconds(date = new Date()) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function daysFromNow(days) {
  return epochSeconds() + Math.max(1, Number(days) || 1) * 24 * 60 * 60;
}

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function getHashSecret() {
  const secret = String(
    process.env.MCP_TOKEN_HASH_SECRET
    || process.env.SOCIAL_AUTH_TOKEN_SECRET
    || process.env.TOKEN_ENCRYPTION_SECRET
    || ''
  ).trim();

  if (!secret && process.env.NODE_ENV === 'production') {
    throw httpError(500, 'MCP token hash secret is not configured');
  }

  return secret || 'local-development-mcp-token-hash-secret';
}

function hashToken(rawToken) {
  return crypto
    .createHmac('sha256', getHashSecret())
    .update(String(rawToken || '').trim())
    .digest('hex');
}

function publicClient(item) {
  if (!item) return null;
  return {
    clientId: item.clientId,
    name: item.name,
    scopes: Array.isArray(item.scopes) ? item.scopes : [],
    status: item.status || 'active',
    ownerSub: item.ownerSub || '',
    createdBy: item.createdBy || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    expiresAt: item.expiresAtEpoch ? new Date(Number(item.expiresAtEpoch) * 1000).toISOString() : null,
    revokedAt: item.revokedAt || null,
    lastUsedAt: item.lastUsedAt || null,
    limits: normalizeLimits(item.limits),
  };
}

function clientListKey() {
  return { pk: 'MCP#CLIENTS' };
}

function clientKey(clientId) {
  return { pk: 'MCP#CLIENTS', sk: `CLIENT#${clientId}` };
}

function tokenKey(tokenHash, clientId = '') {
  return {
    pk: `TOKEN#${tokenHash}`,
    sk: clientId ? `CLIENT#${clientId}` : undefined,
  };
}

function approvalsKey() {
  return { pk: 'MCP#APPROVALS' };
}

function approvalKey(approvalId) {
  return { pk: 'MCP#APPROVALS', sk: `APPROVAL#${approvalId}` };
}

function auditKey(clientId, timestamp, requestHash) {
  return {
    pk: `AUDIT#${timestamp.slice(0, 10)}`,
    sk: `${timestamp}#CLIENT#${clientId || 'unknown'}#${String(requestHash || '').slice(0, 20)}`,
  };
}

function rateKey(clientId, category) {
  const date = new Date().toISOString().slice(0, 10);
  return { pk: `RATE#${clientId}#${date}`, sk: `CATEGORY#${category}` };
}

function idempotencyKey(scope, key) {
  return {
    pk: `IDEMPOTENCY#${sha256Hex(scope)}`,
    sk: `KEY#${sha256Hex(key)}`,
  };
}

function normalizeScopes(scopes) {
  const allowed = new Set(ALL_SCOPES);
  const raw = Array.isArray(scopes) && scopes.length ? scopes : DEFAULT_SCOPES;
  const out = [];
  const seen = new Set();
  for (const scope of raw) {
    const value = String(scope || '').trim();
    if (!value || !allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length ? out : DEFAULT_SCOPES;
}

function normalizeLimits(input = {}) {
  return {
    read: Math.max(1, Math.min(5000, Number(input.read || input.readToolsPerDay || DEFAULT_READ_LIMIT) || DEFAULT_READ_LIMIT)),
    draftMutation: Math.max(1, Math.min(1000, Number(input.draftMutation || input.draftMutationsPerDay || DEFAULT_DRAFT_MUTATION_LIMIT) || DEFAULT_DRAFT_MUTATION_LIMIT)),
    approvalMutation: Math.max(1, Math.min(1000, Number(input.approvalMutation || input.approvalRequestsPerDay || DEFAULT_APPROVAL_LIMIT) || DEFAULT_APPROVAL_LIMIT)),
  };
}

function userSubFrom(user) {
  return String(user?.sub || user?.['cognito:username'] || user?.username || '').trim();
}

function usernameFrom(user) {
  return String(user?.email || user?.['cognito:username'] || user?.username || user?.sub || '').trim();
}

function requestHash(payload) {
  return sha256Hex(JSON.stringify(payload || {}));
}

function normalizeClientName(value) {
  const name = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw httpError(400, 'Client name is required');
  return name.slice(0, 120);
}

async function createClient({ name, scopes, expiresAt, limits } = {}, createdByUser = {}) {
  const ownerSub = userSubFrom(createdByUser);
  if (!ownerSub) throw httpError(401, 'Authenticated user identity is missing');

  const clientId = `mcp-client-${randomToken(12)}`;
  const token = `mcp_${randomToken(36)}`;
  const tokenHash = hashToken(token);
  const timestamp = nowIso();
  const expiresAtEpoch = expiresAt ? epochSeconds(expiresAt) : null;
  if (expiresAtEpoch && expiresAtEpoch <= epochSeconds()) {
    throw httpError(400, 'expiresAt must be in the future');
  }

  const item = {
    ...clientKey(clientId),
    type: 'mcp_client',
    clientId,
    name: normalizeClientName(name),
    scopes: normalizeScopes(scopes),
    tokenHash,
    tokenPrefix: token.slice(0, 12),
    status: 'active',
    ownerSub,
    createdBy: usernameFrom(createdByUser),
    limits: normalizeLimits(limits),
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAtEpoch: expiresAtEpoch || undefined,
  };

  const index = {
    ...tokenKey(tokenHash, clientId),
    type: 'mcp_token_index',
    clientId,
    ownerSub,
    createdAt: timestamp,
    expiresAtEpoch: expiresAtEpoch || undefined,
  };

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  }));

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: index,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  }));

  return {
    client: publicClient(item),
    token,
  };
}

async function listClients(user) {
  const ownerSub = userSubFrom(user);
  if (!ownerSub) throw httpError(401, 'Authenticated user identity is missing');

  const resp = await getDdbDoc().send(new QueryCommand({
    TableName: getTableName(),
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk',
    },
    ExpressionAttributeValues: {
      ':pk': clientListKey().pk,
      ':prefix': 'CLIENT#',
    },
  }));

  const clients = (resp?.Items || [])
    .filter((item) => item.ownerSub === ownerSub)
    .map(publicClient)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { clients, scopes: ALL_SCOPES };
}

async function getClientRecord(clientId) {
  const resp = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: clientKey(clientId),
    ConsistentRead: true,
  }));
  return resp?.Item || null;
}

async function revokeClient(clientId, user) {
  const ownerSub = userSubFrom(user);
  const safeClientId = String(clientId || '').trim();
  if (!safeClientId) throw httpError(400, 'clientId is required');
  const item = await getClientRecord(safeClientId);
  if (!item || item.ownerSub !== ownerSub) throw httpError(404, 'MCP client not found');

  const timestamp = nowIso();
  await getDdbDoc().send(new UpdateCommand({
    TableName: getTableName(),
    Key: clientKey(safeClientId),
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #revokedAt = :revokedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#revokedAt': 'revokedAt',
    },
    ExpressionAttributeValues: {
      ':status': 'revoked',
      ':updatedAt': timestamp,
      ':revokedAt': timestamp,
    },
  }));

  if (item.tokenHash) {
    await getDdbDoc().send(new DeleteCommand({
      TableName: getTableName(),
      Key: tokenKey(item.tokenHash, safeClientId),
    })).catch(() => {});
  }

  return { ok: true, clientId: safeClientId, revokedAt: timestamp };
}

async function authenticateBearer(authorization) {
  const value = String(authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) throw httpError(401, 'Missing MCP bearer token');
  const rawToken = String(match[1] || '').trim();
  if (!rawToken.startsWith('mcp_')) throw httpError(401, 'Invalid MCP bearer token');

  const tokenHash = hashToken(rawToken);
  const tokenResp = await getDdbDoc().send(new QueryCommand({
    TableName: getTableName(),
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': 'pk' },
    ExpressionAttributeValues: { ':pk': tokenKey(tokenHash).pk },
    Limit: 1,
  }));

  const index = (tokenResp?.Items || [])[0];
  if (!index?.clientId) throw httpError(401, 'Invalid MCP bearer token');

  const client = await getClientRecord(index.clientId);
  if (!client || client.status !== 'active' || client.tokenHash !== tokenHash) {
    throw httpError(401, 'MCP client is not active');
  }

  const expiresAtEpoch = Number(client.expiresAtEpoch || 0);
  if (expiresAtEpoch && expiresAtEpoch <= epochSeconds()) {
    throw httpError(401, 'MCP client token is expired');
  }

  const timestamp = nowIso();
  await getDdbDoc().send(new UpdateCommand({
    TableName: getTableName(),
    Key: clientKey(client.clientId),
    UpdateExpression: 'SET #lastUsedAt = :lastUsedAt',
    ExpressionAttributeNames: { '#lastUsedAt': 'lastUsedAt' },
    ExpressionAttributeValues: { ':lastUsedAt': timestamp },
  })).catch(() => {});

  return {
    ...publicClient(client),
    clientId: client.clientId,
    ownerSub: client.ownerSub,
    ownerUser: { sub: client.ownerSub },
  };
}

function requireScope(client, scope) {
  const scopes = new Set(Array.isArray(client?.scopes) ? client.scopes : []);
  if (!scopes.has(scope)) throw httpError(403, `MCP client is missing scope: ${scope}`);
}

function limitForCategory(client, category) {
  const limits = normalizeLimits(client?.limits || {});
  if (category === 'read') return limits.read;
  if (category === 'draftMutation') return limits.draftMutation;
  if (category === 'approvalMutation') return limits.approvalMutation;
  return limits.read;
}

async function consumeRateLimit(client, category) {
  const clientId = String(client?.clientId || '').trim();
  if (!clientId) throw httpError(401, 'MCP client identity is missing');
  const limit = limitForCategory(client, category);

  try {
    const resp = await getDdbDoc().send(new UpdateCommand({
      TableName: getTableName(),
      Key: rateKey(clientId, category),
      UpdateExpression: 'SET #expiresAtEpoch = :ttl ADD #count :one',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#expiresAtEpoch': 'expiresAtEpoch',
      },
      ExpressionAttributeValues: {
        ':one': 1,
        ':limit': limit,
        ':ttl': daysFromNow(2),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return {
      category,
      count: Number(resp?.Attributes?.count || 0),
      limit,
    };
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    await emitMetric('RateLimitHit', 1, { clientId, category });
    throw httpError(429, `MCP ${category} daily limit exceeded`, { category, limit });
  }
}

async function emitMetric(name, value = 1, dimensions = {}) {
  const metric = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: 'Portfolio/MCP',
        Dimensions: [Object.keys(dimensions).slice(0, 8)],
        Metrics: [{ Name: name, Unit: 'Count' }],
      }],
    },
    [name]: Number(value) || 0,
    ...dimensions,
  };
  console.info('[mcp-metric]', JSON.stringify(metric));
}

async function auditToolCall({ client, toolName, targetIds = [], request = {}, status = 'ok', approvalId = '', error = '' } = {}) {
  const timestamp = nowIso();
  const hash = requestHash(request);
  const item = {
    ...auditKey(client?.clientId, timestamp, hash),
    type: 'mcp_audit',
    clientId: client?.clientId || '',
    clientName: client?.name || '',
    ownerSub: client?.ownerSub || '',
    toolName: String(toolName || '').slice(0, 160),
    targetIds: Array.isArray(targetIds) ? targetIds.map(String).slice(0, 20) : [],
    requestHash: hash,
    resultStatus: String(status || 'ok').slice(0, 40),
    approvalId: String(approvalId || '').slice(0, 160),
    error: String(error || '').slice(0, 800),
    timestamp,
    expiresAtEpoch: daysFromNow(AUDIT_TTL_DAYS),
  };

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: item,
  })).catch((err) => {
    console.warn('[mcp] Failed to write audit record:', err?.message || err);
  });
  return item;
}

function publicApproval(item) {
  if (!item) return null;
  return {
    approvalId: item.approvalId,
    status: item.status || 'pending',
    action: item.action,
    summary: item.summary || '',
    targetIds: Array.isArray(item.targetIds) ? item.targetIds : [],
    previewUrl: item.previewUrl || '',
    diff: item.diff || null,
    clientId: item.clientId || '',
    clientName: item.clientName || '',
    ownerSub: item.ownerSub || '',
    payload: item.payload || {},
    result: item.result || null,
    lastError: item.lastError || '',
    createdAt: item.createdAt || null,
    decidedAt: item.decidedAt || null,
    expiresAt: item.expiresAtEpoch ? new Date(Number(item.expiresAtEpoch) * 1000).toISOString() : null,
  };
}

async function createApproval({ client, action, payload = {}, summary = '', targetIds = [], previewUrl = '', diff = null } = {}) {
  const safeAction = String(action || '').trim();
  if (!safeAction) throw httpError(400, 'Approval action is required');
  const approvalId = `approval-${randomToken(14)}`;
  const timestamp = nowIso();
  const item = {
    ...approvalKey(approvalId),
    type: 'mcp_approval',
    approvalId,
    status: 'pending',
    action: safeAction,
    summary: String(summary || safeAction).slice(0, 1200),
    targetIds: Array.isArray(targetIds) ? targetIds.map(String).slice(0, 30) : [],
    previewUrl: String(previewUrl || '').slice(0, 2000),
    diff: diff || null,
    payload,
    requestHash: requestHash({ action: safeAction, payload }),
    clientId: client?.clientId || '',
    clientName: client?.name || '',
    ownerSub: client?.ownerSub || '',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAtEpoch: daysFromNow(APPROVAL_TTL_DAYS),
  };

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  }));
  await emitMetric('ApprovalRequested', 1, { clientId: item.clientId, action: safeAction });
  return publicApproval(item);
}

async function getApproval(approvalId) {
  const safeId = String(approvalId || '').trim();
  if (!safeId) throw httpError(400, 'approvalId is required');
  const resp = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: approvalKey(safeId),
    ConsistentRead: true,
  }));
  return resp?.Item || null;
}

async function listApprovals(user, { status = '', limit = 100 } = {}) {
  const ownerSub = userSubFrom(user);
  if (!ownerSub) throw httpError(401, 'Authenticated user identity is missing');
  const resp = await getDdbDoc().send(new QueryCommand({
    TableName: getTableName(),
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk',
    },
    ExpressionAttributeValues: {
      ':pk': approvalsKey().pk,
      ':prefix': 'APPROVAL#',
    },
    Limit: Math.max(1, Math.min(500, Number(limit) || 100)),
  }));

  const statusFilter = String(status || '').trim().toLowerCase();
  const approvals = (resp?.Items || [])
    .filter((item) => item.ownerSub === ownerSub)
    .filter((item) => !statusFilter || String(item.status || '').toLowerCase() === statusFilter)
    .map(publicApproval)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { approvals };
}

async function decideApproval({ approvalId, decision, reviewerUser, result = null, error = '' } = {}) {
  const ownerSub = userSubFrom(reviewerUser);
  const safeId = String(approvalId || '').trim();
  const safeDecision = String(decision || '').trim().toLowerCase();
  if (!['approved', 'rejected', 'failed', 'executed'].includes(safeDecision)) {
    throw httpError(400, 'Approval decision must be approved, rejected, executed, or failed');
  }

  const current = await getApproval(safeId);
  if (!current || current.ownerSub !== ownerSub) throw httpError(404, 'Approval not found');
  if (current.status !== 'pending' && !['failed', 'executed'].includes(safeDecision)) {
    throw httpError(409, 'Approval is no longer pending');
  }

  const timestamp = nowIso();
  const resp = await getDdbDoc().send(new UpdateCommand({
    TableName: getTableName(),
    Key: approvalKey(safeId),
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #decidedAt = :decidedAt, #decidedBy = :decidedBy, #result = :result, #lastError = :lastError',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#decidedAt': 'decidedAt',
      '#decidedBy': 'decidedBy',
      '#result': 'result',
      '#lastError': 'lastError',
    },
    ExpressionAttributeValues: {
      ':status': safeDecision,
      ':updatedAt': timestamp,
      ':decidedAt': timestamp,
      ':decidedBy': usernameFrom(reviewerUser),
      ':result': result || null,
      ':lastError': String(error || '').slice(0, 1000),
    },
    ReturnValues: 'ALL_NEW',
  }));

  await emitMetric(safeDecision === 'rejected' ? 'ApprovalRejected' : 'ApprovalDecided', 1, {
    action: current.action,
    status: safeDecision,
  });
  return publicApproval(resp?.Attributes || current);
}

async function getIdempotentResult({ scope, key, request }) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return null;
  const reqHash = requestHash(request);
  const resp = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: idempotencyKey(scope, rawKey),
    ConsistentRead: true,
  })).catch((err) => {
    if (err?.name === 'ResourceNotFoundException') return { Item: null };
    throw err;
  });
  const item = resp?.Item;
  if (!item) return null;
  if (item.requestHash !== reqHash) throw httpError(409, 'Idempotency-Key was reused with a different payload');
  return {
    response: item.response,
    statusCode: Number(item.statusCode || 200),
  };
}

async function storeIdempotentResult({ scope, key, request, response, statusCode = 200 }) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return;
  const timestamp = nowIso();
  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...idempotencyKey(scope, rawKey),
      type: 'idempotency_record',
      scope,
      requestHash: requestHash(request),
      response,
      statusCode,
      createdAt: timestamp,
      expiresAtEpoch: daysFromNow(IDEMPOTENCY_TTL_DAYS),
    },
  })).catch((err) => {
    console.warn('[mcp] Failed to store idempotency record:', err?.message || err);
  });
}

module.exports = {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  getTableName,
  createClient,
  listClients,
  revokeClient,
  authenticateBearer,
  requireScope,
  consumeRateLimit,
  auditToolCall,
  emitMetric,
  createApproval,
  getApproval,
  listApprovals,
  decideApproval,
  getIdempotentResult,
  storeIdempotentResult,
  requestHash,
  userSubFrom,
};
