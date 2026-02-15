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

// ElastiCache Redis (and many self-hosted Redis deployments) do not include
// Redis Stack modules like RedisJSON. Prefer JSON.GET when available, but
// always fall back to string GET + JSON.parse for compatibility.
let redisJsonSupported = null; // null = unknown, true/false = known

async function getDocument(key) {
  // Try RedisJSON first if we haven't ruled it out.
  if (redisJsonSupported !== false) {
    try {
      const doc = await redisClient.json.get(key);
      redisJsonSupported = true;
      if (doc !== null && doc !== undefined) return doc;
    } catch (err) {
      const msg = String(err?.message || err);
      // Only treat "unknown command" as a signal that RedisJSON isn't installed.
      if (msg.toLowerCase().includes('unknown command')) {
        redisJsonSupported = false;
      }
      // For wrong-type or other errors, fall through to string GET.
    }
  }

  const str = await redisClient.get(key);
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

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

  const contents = [];

  for (const id of ids) {
    const key = `content:${id}`;
    const doc = await getDocument(key);
    if (doc) contents.push(doc);
    else await removeFromIndex(id); // stale index entry
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
  // node-redis expects cursor as a string
  let cursor = '0';
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
  } while (cursor !== '0');

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
