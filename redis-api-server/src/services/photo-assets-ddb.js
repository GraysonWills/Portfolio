/**
 * DynamoDB-backed photo asset metadata store.
 *
 * Table contract:
 * - PK: asset_id (string)
 * - GSI1: gsi1pk (ASSET), gsi1sk (created_at#asset_id) for global recency listing
 * - GSI2: gsi2pk (OWNER#<username>), gsi2sk (created_at#asset_id) for owner-scoped listing
 */

const {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const { getDdbDoc } = require('./aws/clients');

function getPhotoAssetsTableName() {
  return String(process.env.PHOTO_ASSETS_TABLE_NAME || '').trim();
}

function isPhotoAssetsEnabled() {
  return Boolean(getPhotoAssetsTableName());
}

function requireTableName() {
  const tableName = getPhotoAssetsTableName();
  if (!tableName) {
    throw new Error('PHOTO_ASSETS_TABLE_NAME is not set');
  }
  return tableName;
}

function nowIso() {
  return new Date().toISOString();
}

function toOwnerPk(owner) {
  return `OWNER#${String(owner || 'unknown').trim().toLowerCase() || 'unknown'}`;
}

function toGsiSk(createdAt, assetId) {
  return `${createdAt}#${assetId}`;
}

function toDdbAsset(item) {
  const createdAt = String(item.created_at || nowIso());
  const assetId = String(item.asset_id || '').trim();
  const owner = String(item.owner || 'unknown').trim().toLowerCase() || 'unknown';
  return {
    asset_id: assetId,
    owner,
    status: String(item.status || 'pending').trim().toLowerCase() || 'pending',
    storage_bucket: String(item.storage_bucket || '').trim(),
    storage_key: String(item.storage_key || '').trim(),
    public_url: String(item.public_url || '').trim(),
    original_filename: String(item.original_filename || '').trim(),
    content_type: String(item.content_type || '').trim().toLowerCase(),
    size_bytes: Number.isFinite(item.size_bytes) ? item.size_bytes : 0,
    checksum_sha256: String(item.checksum_sha256 || '').trim().toLowerCase(),
    usage: String(item.usage || '').trim().toLowerCase(),
    tags: Array.isArray(item.tags) ? item.tags : [],
    alt_text: String(item.alt_text || '').trim(),
    caption: String(item.caption || '').trim(),
    width: Number.isFinite(item.width) ? item.width : null,
    height: Number.isFinite(item.height) ? item.height : null,
    e_tag: String(item.e_tag || '').trim(),
    metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata
      : {},
    created_at: createdAt,
    updated_at: String(item.updated_at || createdAt),
    ready_at: String(item.ready_at || '').trim(),
    deleted_at: String(item.deleted_at || '').trim(),
    gsi1pk: 'ASSET',
    gsi1sk: toGsiSk(createdAt, assetId),
    gsi2pk: toOwnerPk(owner),
    gsi2sk: toGsiSk(createdAt, assetId),
  };
}

function toToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64');
}

function fromToken(token) {
  if (!token) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function createPendingPhotoAsset(item) {
  const tableName = requireTableName();
  const asset = toDdbAsset(item);
  if (!asset.asset_id) throw new Error('asset_id is required');

  await getDdbDoc().send(new PutCommand({
    TableName: tableName,
    Item: asset,
    ConditionExpression: 'attribute_not_exists(asset_id)'
  }));

  return asset;
}

async function getPhotoAssetById(assetId) {
  const tableName = requireTableName();
  const resp = await getDdbDoc().send(new GetCommand({
    TableName: tableName,
    Key: { asset_id: assetId },
    ConsistentRead: true
  }));
  return resp?.Item || null;
}

async function listPhotoAssets({ limit = 24, nextToken = '', owner = '', status = '', usage = '' } = {}) {
  const tableName = requireTableName();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};
  const filterExpressions = [];

  let IndexName = 'GSI1';
  let KeyConditionExpression = 'gsi1pk = :gsi1pk';
  expressionAttributeValues[':gsi1pk'] = 'ASSET';

  const normalizedOwner = String(owner || '').trim().toLowerCase();
  if (normalizedOwner) {
    IndexName = 'GSI2';
    KeyConditionExpression = 'gsi2pk = :gsi2pk';
    expressionAttributeValues[':gsi2pk'] = toOwnerPk(normalizedOwner);
  }

  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus) {
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = normalizedStatus;
    filterExpressions.push('#status = :status');
  }

  const normalizedUsage = String(usage || '').trim().toLowerCase();
  if (normalizedUsage) {
    expressionAttributeValues[':usage'] = normalizedUsage;
    filterExpressions.push('usage = :usage');
  }

  const params = {
    TableName: tableName,
    IndexName,
    KeyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: safeLimit,
    ScanIndexForward: false, // newest first
    ExclusiveStartKey: fromToken(nextToken),
  };

  if (Object.keys(expressionAttributeNames).length) {
    params.ExpressionAttributeNames = expressionAttributeNames;
  }
  if (filterExpressions.length) {
    params.FilterExpression = filterExpressions.join(' AND ');
  }

  const resp = await getDdbDoc().send(new QueryCommand(params));
  return {
    items: resp?.Items || [],
    nextToken: toToken(resp?.LastEvaluatedKey)
  };
}

async function markPhotoAssetReady(assetId, patch = {}) {
  const tableName = requireTableName();
  const updatedAt = nowIso();
  const exprNames = {
    '#status': 'status',
    '#updated_at': 'updated_at',
  };
  const exprValues = {
    ':status': 'ready',
    ':updated_at': updatedAt,
  };
  const sets = ['#status = :status', '#updated_at = :updated_at'];

  const optionalFields = [
    'public_url',
    'content_type',
    'size_bytes',
    'e_tag',
    'width',
    'height',
    'alt_text',
    'caption',
    'tags',
    'metadata',
    'checksum_sha256',
    'ready_at',
  ];

  for (const field of optionalFields) {
    if (patch[field] === undefined) continue;
    const nameKey = `#${field}`;
    const valueKey = `:${field}`;
    exprNames[nameKey] = field;
    exprValues[valueKey] = patch[field];
    sets.push(`${nameKey} = ${valueKey}`);
  }

  const resp = await getDdbDoc().send(new UpdateCommand({
    TableName: tableName,
    Key: { asset_id: assetId },
    ConditionExpression: 'attribute_exists(asset_id)',
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ReturnValues: 'ALL_NEW'
  }));

  return resp?.Attributes || null;
}

async function markPhotoAssetDeleted(assetId, patch = {}) {
  const tableName = requireTableName();
  const deletedAt = nowIso();
  const updatedAt = deletedAt;
  const resp = await getDdbDoc().send(new UpdateCommand({
    TableName: tableName,
    Key: { asset_id: assetId },
    ConditionExpression: 'attribute_exists(asset_id)',
    UpdateExpression: 'SET #status = :status, #deleted_at = :deleted_at, #updated_at = :updated_at, #hard_deleted = :hard_deleted',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#deleted_at': 'deleted_at',
      '#updated_at': 'updated_at',
      '#hard_deleted': 'hard_deleted',
    },
    ExpressionAttributeValues: {
      ':status': 'deleted',
      ':deleted_at': deletedAt,
      ':updated_at': updatedAt,
      ':hard_deleted': Boolean(patch.hard_deleted),
    },
    ReturnValues: 'ALL_NEW'
  }));
  return resp?.Attributes || null;
}

async function deletePhotoAssetRecord(assetId) {
  const tableName = requireTableName();
  await getDdbDoc().send(new DeleteCommand({
    TableName: tableName,
    Key: { asset_id: assetId }
  }));
}

module.exports = {
  getPhotoAssetsTableName,
  isPhotoAssetsEnabled,
  createPendingPhotoAsset,
  getPhotoAssetById,
  listPhotoAssets,
  markPhotoAssetReady,
  markPhotoAssetDeleted,
  deletePhotoAssetRecord,
};

