/**
 * DynamoDB-backed preview sessions.
 *
 * This replaces Redis-based preview payload storage so preview mode can work
 * when Redis is fully disabled.
 */

const { PutCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { getDdbDoc } = require('./aws/clients');

const DEFAULT_PREVIEW_SESSIONS_TABLE = 'portfolio-content-preview-sessions';

function getPreviewSessionsTableName() {
  return String(process.env.PREVIEW_SESSIONS_TABLE_NAME || DEFAULT_PREVIEW_SESSIONS_TABLE).trim();
}

function isPreviewSessionsDdbEnabled() {
  return Boolean(getPreviewSessionsTableName());
}

function requireTableName() {
  const name = getPreviewSessionsTableName();
  if (!name) throw new Error('PREVIEW_SESSIONS_TABLE_NAME is not set');
  return name;
}

async function putPreviewSession(token, payload, ttlSeconds) {
  const tableName = requireTableName();
  const ttl = Math.max(60, parseInt(ttlSeconds, 10) || 21600);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const expiresAtEpoch = nowEpoch + ttl;

  await getDdbDoc().send(new PutCommand({
    TableName: tableName,
    Item: {
      token,
      payload,
      createdAt: new Date().toISOString(),
      expiresAtEpoch
    }
  }));

  return {
    expiresAtEpoch,
    expiresInSeconds: ttl
  };
}

async function getPreviewSession(token) {
  const tableName = requireTableName();
  const res = await getDdbDoc().send(new GetCommand({
    TableName: tableName,
    Key: { token },
    ConsistentRead: true
  }));

  const item = res?.Item || null;
  if (!item) return null;

  const expiresAtEpoch = parseInt(item.expiresAtEpoch, 10) || 0;
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (expiresAtEpoch > 0 && expiresAtEpoch <= nowEpoch) {
    // Best effort cleanup if TTL worker has not removed it yet.
    await deletePreviewSession(token).catch(() => {});
    return null;
  }

  return item.payload || null;
}

async function deletePreviewSession(token) {
  const tableName = requireTableName();
  await getDdbDoc().send(new DeleteCommand({
    TableName: tableName,
    Key: { token }
  }));
}

module.exports = {
  getPreviewSessionsTableName,
  isPreviewSessionsDdbEnabled,
  putPreviewSession,
  getPreviewSession,
  deletePreviewSession,
};

