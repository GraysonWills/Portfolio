/**
 * DynamoDB-backed content store.
 *
 * This is used to make portfolio/blog content multi-region (via DynamoDB Global Tables)
 * without requiring ElastiCache Global Datastore (which requires large instance classes).
 *
 * Data shape matches the existing Redis content documents (capitalized fields).
 */

const {
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const { getDdbDoc } = require('./aws/clients');

function getContentTableName() {
  return process.env.CONTENT_TABLE_NAME || '';
}

function isContentDdbEnabled() {
  return Boolean(getContentTableName());
}

function requireTableName() {
  const name = getContentTableName();
  if (!name) throw new Error('CONTENT_TABLE_NAME is not set');
  return name;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function batchWriteAll(tableName, writeRequests) {
  const ddb = getDdbDoc();
  let pending = writeRequests.slice();
  let attempt = 0;

  while (pending.length) {
    const batch = pending.slice(0, 25);
    pending = pending.slice(25);

    const resp = await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [tableName]: batch }
      })
    );

    const unprocessed = resp?.UnprocessedItems?.[tableName] || [];
    if (unprocessed.length) {
      attempt++;
      if (attempt > 8) {
        throw new Error(`Too many unprocessed items after retries (${unprocessed.length} remaining)`);
      }
      const backoff = Math.min(2000, 50 * Math.pow(2, attempt));
      await sleep(backoff);
      pending = unprocessed.concat(pending);
    } else {
      attempt = 0;
    }
  }
}

async function ddbPutContent(item) {
  const tableName = requireTableName();
  await getDdbDoc().send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

async function ddbBatchPutContent(items) {
  const tableName = requireTableName();
  const requests = items.map(Item => ({ PutRequest: { Item } }));
  await batchWriteAll(tableName, requests);
  return items;
}

async function ddbGetContentById(id) {
  const tableName = requireTableName();
  const resp = await getDdbDoc().send(
    new GetCommand({
      TableName: tableName,
      Key: { ID: id },
      ConsistentRead: true
    })
  );
  return resp?.Item || null;
}

async function ddbDeleteContentById(id) {
  const tableName = requireTableName();
  await getDdbDoc().send(new DeleteCommand({ TableName: tableName, Key: { ID: id } }));
}

async function ddbScanAllContent() {
  const tableName = requireTableName();
  const ddb = getDdbDoc();
  const items = [];

  let ExclusiveStartKey = undefined;
  do {
    const resp = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey,
        ConsistentRead: true
      })
    );
    if (Array.isArray(resp?.Items)) items.push(...resp.Items);
    ExclusiveStartKey = resp?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function ddbGetContentByPageId(pageId) {
  const tableName = requireTableName();
  const ddb = getDdbDoc();
  const items = [];

  let ExclusiveStartKey = undefined;
  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'PageIndex',
        KeyConditionExpression: 'PageID = :pid',
        ExpressionAttributeValues: { ':pid': pageId },
        ExclusiveStartKey,
      })
    );
    if (Array.isArray(resp?.Items)) items.push(...resp.Items);
    ExclusiveStartKey = resp?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function ddbGetContentByPageAndContentId(pageId, pageContentId) {
  const tableName = requireTableName();
  const ddb = getDdbDoc();

  const resp = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'PageIndex',
      KeyConditionExpression: 'PageID = :pid AND PageContentID = :pcid',
      ExpressionAttributeValues: { ':pid': pageId, ':pcid': pageContentId },
    })
  );

  return resp?.Items || [];
}

async function ddbGetContentByListItemId(listItemId) {
  const tableName = requireTableName();
  const ddb = getDdbDoc();
  const items = [];

  let ExclusiveStartKey = undefined;
  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'ListItemIndex',
        KeyConditionExpression: 'ListItemID = :lid',
        ExpressionAttributeValues: { ':lid': listItemId },
        ExclusiveStartKey,
      })
    );
    if (Array.isArray(resp?.Items)) items.push(...resp.Items);
    ExclusiveStartKey = resp?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function ddbDeleteContentByListItemId(listItemId) {
  const tableName = requireTableName();
  const items = await ddbGetContentByListItemId(listItemId);
  if (!items.length) return 0;

  const requests = items.map(i => ({ DeleteRequest: { Key: { ID: i.ID } } }));
  await batchWriteAll(tableName, requests);
  return items.length;
}

async function ddbPing() {
  const tableName = requireTableName();
  const start = Date.now();
  await getDdbDoc().send(new ScanCommand({ TableName: tableName, Limit: 1, ConsistentRead: true }));
  return { ok: true, latencyMs: Date.now() - start };
}

module.exports = {
  getContentTableName,
  isContentDdbEnabled,
  ddbPing,
  ddbPutContent,
  ddbBatchPutContent,
  ddbGetContentById,
  ddbDeleteContentById,
  ddbScanAllContent,
  ddbGetContentByPageId,
  ddbGetContentByPageAndContentId,
  ddbGetContentByListItemId,
  ddbDeleteContentByListItemId,
};

