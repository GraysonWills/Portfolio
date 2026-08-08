/**
 * Shared content reads.
 *
 * The redis-primary / DynamoDB-fallback policy used to be inlined in
 * routes/content.js. The discovery feeds need the exact same reads, and two
 * copies of a fallback policy is how they quietly drift apart, so it lives
 * here once and both callers import it.
 */
const { getContentWhere } = require('../utils/content-index');
const {
  isContentDdbEnabled,
  ddbGetContentByPageAndContentId
} = require('./content-ddb');

function useDdbAsPrimary() {
  const backend = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
  return backend === 'dynamodb' || backend === 'ddb';
}

/**
 * All content rows for one page + content id. Backed by the PageIndex GSI on
 * DynamoDB, so this reads roughly one row per post rather than scanning.
 */
async function readContentByPageAndContent(pageId, contentId) {
  const safePageId = Number(pageId);
  const safeContentId = Number(contentId);
  if (!Number.isFinite(safePageId) || !Number.isFinite(safeContentId)) return [];

  if (useDdbAsPrimary()) {
    return ddbGetContentByPageAndContentId(safePageId, safeContentId);
  }

  try {
    return await getContentWhere(
      (item) => Number(item.PageID) === safePageId && Number(item.PageContentID) === safeContentId
    );
  } catch (err) {
    if (!isContentDdbEnabled()) throw err;
    return ddbGetContentByPageAndContentId(safePageId, safeContentId);
  }
}

module.exports = { readContentByPageAndContent };
