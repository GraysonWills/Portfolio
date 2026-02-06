/**
 * Content Index — Maintains a Redis Set (`content:_index`) of all content IDs.
 *
 * Why: Every route previously used `KEYS content:*` which is O(n) and blocks
 * the entire Redis instance. This module replaces that with:
 *   - A Set (`content:_index`) tracking all known content IDs
 *   - `SMEMBERS` + batched `JSON.GET` for reads (non-blocking, O(1) per key)
 *   - Automatic index maintenance on create/update/delete
 *   - A `rebuildIndex()` function for one-time migration via `SCAN`
 */

const redisClient = require('../config/redis');

const INDEX_KEY = 'content:_index';

/**
 * Add a content ID to the index Set.
 */
async function addToIndex(contentId) {
  await redisClient.sAdd(INDEX_KEY, contentId);
}

/**
 * Remove a content ID from the index Set.
 */
async function removeFromIndex(contentId) {
  await redisClient.sRem(INDEX_KEY, contentId);
}

/**
 * Get all content IDs from the index Set.
 * Returns an array of strings like ['header-text-001', 'blog-post-001', ...].
 */
async function getAllIds() {
  return await redisClient.sMembers(INDEX_KEY);
}

/**
 * Get all content documents. Uses the index Set instead of KEYS.
 * Falls back to SCAN-based rebuild if the index is empty (first run).
 */
async function getAllContent() {
  let ids = await getAllIds();

  // If index is empty, rebuild it from existing keys (migration path)
  if (ids.length === 0) {
    await rebuildIndex();
    ids = await getAllIds();
  }

  if (ids.length === 0) return [];

  // Batch-fetch all documents
  const pipeline = redisClient.multi();
  for (const id of ids) {
    pipeline.json.get(`content:${id}`);
  }

  const results = await pipeline.exec();
  const contents = [];

  for (let i = 0; i < results.length; i++) {
    const doc = results[i];
    if (doc) {
      contents.push(doc);
    } else {
      // Stale index entry — clean it up
      await removeFromIndex(ids[i]);
    }
  }

  return contents;
}

/**
 * Get content filtered by a predicate function.
 * More efficient than KEYS: reads the index, batches fetches, filters in JS.
 */
async function getContentWhere(predicate) {
  const all = await getAllContent();
  return all.filter(predicate);
}

/**
 * Rebuild the index from existing Redis keys using SCAN (non-blocking).
 * Safe to call at any time — idempotent.
 */
async function rebuildIndex() {
  console.log('[content-index] Rebuilding index from SCAN...');
  let cursor = 0;
  let count = 0;

  do {
    const result = await redisClient.scan(cursor, { MATCH: 'content:*', COUNT: 100 });
    cursor = result.cursor;

    for (const key of result.keys) {
      // Skip the index key itself and any non-content keys
      if (key === INDEX_KEY) continue;
      const id = key.replace('content:', '');
      await redisClient.sAdd(INDEX_KEY, id);
      count++;
    }
  } while (cursor !== 0);

  console.log(`[content-index] Index rebuilt: ${count} entries`);
}

module.exports = {
  INDEX_KEY,
  addToIndex,
  removeFromIndex,
  getAllIds,
  getAllContent,
  getContentWhere,
  rebuildIndex,
};
