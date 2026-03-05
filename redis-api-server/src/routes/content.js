/**
 * Content Routes
 * Handles all Redis content operations.
 *
 * Uses content-index (Redis Set) instead of KEYS for all reads.
 * See utils/content-index.js for the rationale.
 */

const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const requireAuth = require('../middleware/requireAuth');
const {
  addToIndex,
  removeFromIndex,
  getAllContent,
  getContentWhere,
} = require('../utils/content-index');
const {
  isContentDdbEnabled,
  ddbScanAllContent,
  ddbGetContentById,
  ddbGetContentByPageId,
  ddbGetContentByPageAndContentId,
  ddbGetContentByListItemId,
  ddbPutContent,
  ddbBatchPutContent,
  ddbDeleteContentById,
  ddbDeleteContentByListItemId,
} = require('../services/content-ddb');
const {
  isPreviewSessionsDdbEnabled,
  putPreviewSession,
  getPreviewSession
} = require('../services/preview-session-ddb');
const { rewriteContentItemMediaUrls } = require('../utils/media-url');
const {
  BLOG_PAGE_ID,
  BLOG_IMAGE_CONTENT_ID,
  clampLimit,
  parsePageSort,
  parseProjection,
  parseBoolean,
  parseCsvNumbers,
  parseCsvStrings,
  parseStatusFilter,
  normalizeContentItem,
  sortPageItems,
  projectContentItem,
  buildBlogCardsFromPageItems,
  filterBlogCards,
  sortBlogCards,
  stripBlogCardInternals,
  groupItemsByListItemId,
  filterByContentIds,
  pageSlice
} = require('../services/content-v2');
const {
  computeFilterHash,
  encodeOffsetToken,
  decodeOffsetToken
} = require('../utils/pagination-token');

const CONTENT_BACKEND = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
const useDdbAsPrimary = CONTENT_BACKEND === 'dynamodb' || CONTENT_BACKEND === 'ddb';
const PREVIEW_KEY_PREFIX = 'content:preview:';
const redisConfigured = !!redisClient.isConfigured;
const PREVIEW_TTL_SECONDS = Math.max(300, parseInt(process.env.PREVIEW_TTL_SECONDS || '21600', 10) || 21600);
const PREVIEW_MAX_UPSERTS = Math.max(1, parseInt(process.env.PREVIEW_MAX_UPSERTS || '500', 10) || 500);
const PREVIEW_MAX_DELETES = Math.max(0, parseInt(process.env.PREVIEW_MAX_DELETES || '500', 10) || 500);
const PREVIEW_MAX_BYTES = Math.max(16_384, parseInt(process.env.PREVIEW_MAX_BYTES || '1048576', 10) || 1048576);

function normalizeContentArray(items, req) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => rewriteContentItemMediaUrls(item, req));
}

function normalizeContentRecord(item, req) {
  if (!item || typeof item !== 'object') return item;
  return rewriteContentItemMediaUrls(item, req);
}

function logV2Metric(route, startedAt, extra = {}) {
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const metric = {
    route,
    latencyMs: Number(latencyMs.toFixed(2)),
    ...extra
  };
  console.info('[content-v2-metric]', JSON.stringify(metric));
}

async function readContentByPage(pageId) {
  if (useDdbAsPrimary) {
    return ddbGetContentByPageId(pageId);
  }

  try {
    return await getContentWhere((item) => Number(item.PageID) === Number(pageId));
  } catch (err) {
    if (!isContentDdbEnabled()) throw err;
    return ddbGetContentByPageId(pageId);
  }
}

async function readContentByListItemIds(listItemIds) {
  const requested = Array.isArray(listItemIds) ? listItemIds : [];
  if (!requested.length) return [];

  if (useDdbAsPrimary) {
    const groups = await Promise.all(requested.map((id) => ddbGetContentByListItemId(id)));
    return groups.flat();
  }

  const requestedSet = new Set(requested);
  try {
    return await getContentWhere((item) => requestedSet.has(String(item.ListItemID || '')));
  } catch (err) {
    if (!isContentDdbEnabled()) throw err;
    const groups = await Promise.all(requested.map((id) => ddbGetContentByListItemId(id)));
    return groups.flat();
  }
}

// Public reads; authenticated writes.
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/v2/list-items/batch') {
    return next();
  }
  if (req.method === 'GET') return next();
  return requireAuth(req, res, next);
});

/**
 * GET /api/content
 * Get all content from Redis
 */
router.get('/', async (req, res) => {
  try {
    if (useDdbAsPrimary) {
      const contents = await ddbScanAllContent();
      return res.json(normalizeContentArray(contents, req));
    }

    try {
      const contents = await getAllContent();
      return res.json(normalizeContentArray(contents, req));
    } catch (err) {
      // Redis down? Fall back to DynamoDB if configured.
      if (isContentDdbEnabled()) {
        const contents = await ddbScanAllContent();
        return res.json(normalizeContentArray(contents, req));
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/content/preview/session
 * Create a short-lived preview session payload used by portfolio CloudFront previews.
 */
router.post('/preview/session', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const upserts = Array.isArray(body.upserts) ? body.upserts : [];
    const deleteIds = Array.isArray(body.deleteIds) ? body.deleteIds : [];
    const deleteListItemIds = Array.isArray(body.deleteListItemIds) ? body.deleteListItemIds : [];
    const forceVisibleListItemIds = Array.isArray(body.forceVisibleListItemIds) ? body.forceVisibleListItemIds : [];

    if (upserts.length > PREVIEW_MAX_UPSERTS) {
      return res.status(400).json({ error: `Too many upserts (max ${PREVIEW_MAX_UPSERTS})` });
    }
    if (deleteIds.length > PREVIEW_MAX_DELETES || deleteListItemIds.length > PREVIEW_MAX_DELETES) {
      return res.status(400).json({ error: `Too many deletes (max ${PREVIEW_MAX_DELETES})` });
    }

    for (const item of upserts) {
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ error: 'Invalid upsert entry' });
      }
      if (!item.ID || typeof item.ID !== 'string') {
        return res.status(400).json({ error: 'Each upsert must include string ID' });
      }
    }

    const payload = {
      upserts,
      deleteIds: deleteIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()),
      deleteListItemIds: deleteListItemIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()),
      forceVisibleListItemIds: forceVisibleListItemIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()),
      createdAt: new Date().toISOString(),
      source: typeof body.source === 'string' ? body.source : 'authoring',
    };

    const encoded = JSON.stringify(payload);
    const bytes = Buffer.byteLength(encoded, 'utf8');
    if (bytes > PREVIEW_MAX_BYTES) {
      return res.status(400).json({ error: `Preview payload too large (${bytes} bytes; max ${PREVIEW_MAX_BYTES})` });
    }

    const token = crypto.randomBytes(18).toString('hex');
    let stored = false;

    if (isPreviewSessionsDdbEnabled()) {
      try {
        await putPreviewSession(token, payload, PREVIEW_TTL_SECONDS);
        stored = true;
      } catch (err) {
        if (!redisConfigured) throw err;
        console.warn('[preview] Failed to store preview session in DynamoDB, falling back to Redis:', err.message);
      }
    }

    if (!stored) {
      if (!redisConfigured) {
        return res.status(500).json({ error: 'Preview session store is not configured' });
      }
      const key = `${PREVIEW_KEY_PREFIX}${token}`;
      await redisClient.set(key, encoded, { EX: PREVIEW_TTL_SECONDS });
    }

    return res.status(201).json({
      token,
      expiresInSeconds: PREVIEW_TTL_SECONDS
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/preview/:token
 * Fetch preview payload by token.
 */
router.get('/preview/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!/^[a-f0-9]{20,128}$/i.test(token)) {
      return res.status(400).json({ error: 'Invalid preview token' });
    }

    let payload = null;
    let ddbError = null;

    if (isPreviewSessionsDdbEnabled()) {
      try {
        payload = await getPreviewSession(token);
      } catch (err) {
        ddbError = err;
      }
    }

    if (!payload && redisConfigured) {
      const key = `${PREVIEW_KEY_PREFIX}${token}`;
      const raw = await redisClient.get(key);
      if (raw) {
        payload = JSON.parse(raw);
      }
    }

    if (!payload) {
      if (ddbError && !redisConfigured) throw ddbError;
      return res.status(404).json({ error: 'Preview session not found or expired' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/v2/page/:pageId
 * Paged content read with optional projection and filtering.
 */
router.get('/v2/page/:pageId', async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const pageId = Number.parseInt(req.params.pageId, 10);
    if (!Number.isFinite(pageId)) {
      return res.status(400).json({ error: 'Invalid pageId' });
    }

    const limit = clampLimit(req.query.limit, { defaultValue: 30, min: 1, max: 100 });
    const sort = parsePageSort(req.query.sort);
    const fields = parseProjection(req.query.fields);
    const contentIds = parseCsvNumbers(req.query.contentIds, { maxItems: 100 });

    const filterContext = {
      route: 'v2/page',
      pageId,
      contentIds: [...contentIds].sort((a, b) => a - b),
      sort,
      fields
    };
    const filterHash = computeFilterHash(filterContext);

    let offset = 0;
    if (req.query.nextToken) {
      let decodedToken;
      try {
        decodedToken = decodeOffsetToken(req.query.nextToken);
      } catch (tokenErr) {
        console.warn('[content-v2] nextToken decode failed for /v2/page:', tokenErr.message);
        return res.status(400).json({ error: 'Invalid nextToken' });
      }

      if (decodedToken.filterHash !== filterHash || decodedToken.sort !== sort) {
        console.warn('[content-v2] nextToken rejected on /v2/page due to filter mismatch');
        return res.status(400).json({ error: 'nextToken does not match the current filters' });
      }
      offset = decodedToken.offset;
    }

    const sourceItems = await readContentByPage(pageId);
    const normalized = sourceItems
      .map(normalizeContentItem)
      .filter(Boolean);
    const byContentId = filterByContentIds(normalized, contentIds);
    const sorted = sortPageItems(byContentId, sort);
    const pageSliceResult = pageSlice(sorted, offset, limit);

    const projected = pageSliceResult.items.map((item) => projectContentItem(item, fields));
    const items = normalizeContentArray(projected, req);
    const nextToken = pageSliceResult.hasMore
      ? encodeOffsetToken({
          offset: pageSliceResult.nextOffset,
          sort,
          filterHash
        })
      : null;

    logV2Metric('/v2/page/:pageId', startedAt, {
      pageId,
      returned: items.length,
      hasMore: pageSliceResult.hasMore
    });

    return res.json({
      items,
      nextToken,
      page: {
        pageId,
        limit,
        returned: items.length,
        hasMore: pageSliceResult.hasMore,
        sort
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/v2/blog/cards
 * Blog metadata feed (no image payload in this endpoint).
 */
router.get('/v2/blog/cards', async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const limit = clampLimit(req.query.limit, { defaultValue: 12, min: 1, max: 50 });
    const status = parseStatusFilter(req.query.status, 'published');
    const includeFuture = parseBoolean(req.query.includeFuture, false);
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();

    const filterContext = {
      route: 'v2/blog/cards',
      status,
      includeFuture,
      q: q.toLowerCase(),
      category: category.toLowerCase()
    };
    const filterHash = computeFilterHash(filterContext);

    let offset = 0;
    if (req.query.nextToken) {
      let decodedToken;
      try {
        decodedToken = decodeOffsetToken(req.query.nextToken);
      } catch (tokenErr) {
        console.warn('[content-v2] nextToken decode failed for /v2/blog/cards:', tokenErr.message);
        return res.status(400).json({ error: 'Invalid nextToken' });
      }

      if (decodedToken.filterHash !== filterHash) {
        console.warn('[content-v2] nextToken rejected on /v2/blog/cards due to filter mismatch');
        return res.status(400).json({ error: 'nextToken does not match the current filters' });
      }
      offset = decodedToken.offset;
    }

    const pageItems = await readContentByPage(BLOG_PAGE_ID);
    const cards = buildBlogCardsFromPageItems(pageItems);
    const filtered = filterBlogCards(cards, { status, includeFuture, q, category });
    const sorted = sortBlogCards(filtered);
    const pageSliceResult = pageSlice(sorted, offset, limit);

    const items = pageSliceResult.items.map(stripBlogCardInternals);
    const nextToken = pageSliceResult.hasMore
      ? encodeOffsetToken({
          offset: pageSliceResult.nextOffset,
          sort: 'publish_desc',
          filterHash
        })
      : null;

    logV2Metric('/v2/blog/cards', startedAt, {
      returned: items.length,
      hasMore: pageSliceResult.hasMore,
      status
    });

    return res.json({
      items,
      nextToken,
      page: {
        limit,
        returned: items.length,
        hasMore: pageSliceResult.hasMore
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/v2/blog/cards/media
 * Resolve card image URLs for visible blog cards.
 */
router.get('/v2/blog/cards/media', async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const listItemIDs = parseCsvStrings(req.query.listItemIDs, { maxItems: 50 });
    if (!listItemIDs.length) {
      return res.status(400).json({ error: 'listItemIDs is required (max 50)' });
    }

    const allItems = await readContentByListItemIds(listItemIDs);
    const normalized = allItems
      .map(normalizeContentItem)
      .filter(Boolean)
      .filter((item) => Number(item.PageID) === BLOG_PAGE_ID && Number(item.PageContentID) === BLOG_IMAGE_CONTENT_ID);

    const byListItem = groupItemsByListItemId(normalized, listItemIDs);
    const mediaItems = [];

    for (const listItemID of listItemIDs) {
      const rows = (byListItem[listItemID] || []).sort((a, b) => {
        const aTs = new Date(a?.UpdatedAt || a?.CreatedAt || 0).getTime() || 0;
        const bTs = new Date(b?.UpdatedAt || b?.CreatedAt || 0).getTime() || 0;
        return bTs - aTs;
      });
      const top = rows.find((row) => typeof row?.Photo === 'string' && row.Photo.trim());
      if (!top) continue;
      const rewritten = normalizeContentRecord(top, req);
      mediaItems.push({
        listItemID,
        imageUrl: rewritten.Photo
      });
    }

    logV2Metric('/v2/blog/cards/media', startedAt, {
      requested: listItemIDs.length,
      returned: mediaItems.length
    });

    return res.json({ items: mediaItems });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/content/v2/list-items/batch
 * Batch read content grouped by list-item ID.
 */
router.post('/v2/list-items/batch', async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedIdsRaw = Array.isArray(body.listItemIDs) ? body.listItemIDs : [];
    const requestedIds = [];
    const seen = new Set();
    for (const value of requestedIdsRaw) {
      if (requestedIds.length >= 50) break;
      const normalized = String(value || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      requestedIds.push(normalized);
    }

    if (!requestedIds.length) {
      return res.status(400).json({ error: 'listItemIDs is required (1-50 IDs)' });
    }

    const contentIds = Array.isArray(body.contentIds)
      ? body.contentIds
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
          .slice(0, 100)
      : [];

    const allItems = await readContentByListItemIds(requestedIds);
    const normalized = allItems
      .map(normalizeContentItem)
      .filter(Boolean);
    const narrowed = filterByContentIds(normalized, contentIds);
    const grouped = groupItemsByListItemId(narrowed, requestedIds);

    const normalizedResponse = {};
    for (const listItemID of requestedIds) {
      normalizedResponse[listItemID] = normalizeContentArray(grouped[listItemID] || [], req);
    }

    logV2Metric('/v2/list-items/batch', startedAt, {
      requested: requestedIds.length,
      returnedGroups: Object.keys(normalizedResponse).length
    });

    return res.json({
      itemsByListItemID: normalizedResponse
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/page/:pageId
 * Get content by PageID
 */
router.get('/page/:pageId', async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId);
    if (useDdbAsPrimary) {
      const contents = await ddbGetContentByPageId(pageId);
      return res.json(normalizeContentArray(contents, req));
    }

    try {
      const contents = await getContentWhere(item => item.PageID === pageId);
      return res.json(normalizeContentArray(contents, req));
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByPageId(pageId);
        return res.json(normalizeContentArray(contents, req));
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/page/:pageId/content/:contentId
 * Get content by PageID and PageContentID
 */
router.get('/page/:pageId/content/:contentId', async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId);
    const contentId = parseInt(req.params.contentId);
    if (useDdbAsPrimary) {
      const contents = await ddbGetContentByPageAndContentId(pageId, contentId);
      return res.json(normalizeContentArray(contents, req));
    }

    try {
      const contents = await getContentWhere(
        item => item.PageID === pageId && item.PageContentID === contentId
      );
      return res.json(normalizeContentArray(contents, req));
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByPageAndContentId(pageId, contentId);
        return res.json(normalizeContentArray(contents, req));
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/list-item/:listItemId
 * Get content by ListItemID
 */
router.get('/list-item/:listItemId', async (req, res) => {
  try {
    const listItemId = req.params.listItemId;
    if (useDdbAsPrimary) {
      const contents = await ddbGetContentByListItemId(listItemId);
      return res.json(normalizeContentArray(contents, req));
    }

    try {
      const contents = await getContentWhere(item => item.ListItemID === listItemId);
      return res.json(normalizeContentArray(contents, req));
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByListItemId(listItemId);
        return res.json(normalizeContentArray(contents, req));
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/:id
 * Get content by ID
 */
router.get('/:id', async (req, res) => {
  try {
    if (useDdbAsPrimary) {
      const content = await ddbGetContentById(req.params.id);
      if (!content) return res.status(404).json({ error: 'Content not found' });
      return res.json(normalizeContentRecord(content, req));
    }

    const key = `content:${req.params.id}`;
    let content;

    try {
      content = await redisClient.json.get(key);
    } catch (err) {
      const str = await redisClient.get(key);
      if (str) content = JSON.parse(str);
    }

    if (!content && isContentDdbEnabled()) {
      content = await ddbGetContentById(req.params.id);
    }

    if (!content) return res.status(404).json({ error: 'Content not found' });

    res.json(normalizeContentRecord(content, req));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/content
 * Create a new content item
 */
router.post('/', async (req, res) => {
  try {
    const content = req.body;

    if (!content.ID) {
      content.ID = uuidv4();
    }
    if (!content.CreatedAt) {
      content.CreatedAt = new Date().toISOString();
    }
    content.UpdatedAt = new Date().toISOString();

    if (useDdbAsPrimary) {
      await ddbPutContent(content);
    } else {
      const key = `content:${content.ID}`;
      try {
        await redisClient.json.set(key, '$', content);
      } catch (err) {
        await redisClient.set(key, JSON.stringify(content));
      }

      // Maintain the index
      await addToIndex(content.ID);

      // Optional: keep DynamoDB in sync for multi-region DR.
      if (isContentDdbEnabled()) {
        await ddbPutContent(content);
      }
    }

    res.status(201).json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/content/batch
 * Create multiple content items
 */
router.post('/batch', async (req, res) => {
  try {
    const contents = Array.isArray(req.body) ? req.body : [req.body];
    const created = [];

    for (const content of contents) {
      if (!content.ID) content.ID = uuidv4();
      if (!content.CreatedAt) content.CreatedAt = new Date().toISOString();
      content.UpdatedAt = new Date().toISOString();
      created.push(content);
    }

    if (useDdbAsPrimary) {
      await ddbBatchPutContent(created);
    } else {
      for (const content of created) {
        const key = `content:${content.ID}`;
        try {
          await redisClient.json.set(key, '$', content);
        } catch (err) {
          await redisClient.set(key, JSON.stringify(content));
        }
        await addToIndex(content.ID);
      }

      if (isContentDdbEnabled()) {
        await ddbBatchPutContent(created);
      }
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/content/:id
 * Update content by ID
 */
router.put('/:id', async (req, res) => {
  try {
    if (useDdbAsPrimary) {
      const existing = await ddbGetContentById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Content not found' });

      const updated = {
        ...existing,
        ...req.body,
        ID: req.params.id,
        UpdatedAt: new Date().toISOString()
      };

      await ddbPutContent(updated);
      return res.json(updated);
    }

    const key = `content:${req.params.id}`;
    let existing;

    try {
      existing = await redisClient.json.get(key);
    } catch (err) {
      const str = await redisClient.get(key);
      if (str) existing = JSON.parse(str);
    }

    if (!existing && isContentDdbEnabled()) {
      existing = await ddbGetContentById(req.params.id);
    }

    if (!existing) return res.status(404).json({ error: 'Content not found' });

    const updated = {
      ...existing,
      ...req.body,
      ID: req.params.id,
      UpdatedAt: new Date().toISOString()
    };

    try {
      await redisClient.json.set(key, '$', updated);
    } catch (err) {
      await redisClient.set(key, JSON.stringify(updated));
    }

    // Ensure index is current (idempotent)
    await addToIndex(req.params.id);

    if (isContentDdbEnabled()) {
      await ddbPutContent(updated);
    }

    return res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/content/:id
 * Delete content by ID
 */
router.delete('/:id', async (req, res) => {
  try {
    if (useDdbAsPrimary) {
      const existing = await ddbGetContentById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Content not found' });

      await ddbDeleteContentById(req.params.id);
      return res.json({ message: 'Content deleted successfully' });
    }

    const key = `content:${req.params.id}`;
    const exists = await redisClient.exists(key);

    if (!exists && isContentDdbEnabled()) {
      const existing = await ddbGetContentById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Content not found' });
    } else if (!exists) {
      return res.status(404).json({ error: 'Content not found' });
    }

    await redisClient.del(key);
    await removeFromIndex(req.params.id);

    if (isContentDdbEnabled()) {
      await ddbDeleteContentById(req.params.id);
    }

    return res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/content/list-item/:listItemId
 * Delete all content by ListItemID
 */
router.delete('/list-item/:listItemId', async (req, res) => {
  try {
    const listItemId = req.params.listItemId;
    if (useDdbAsPrimary) {
      const deleted = await ddbDeleteContentByListItemId(listItemId);
      return res.json({
        message: `Deleted ${deleted} content item(s)`,
        deleted
      });
    }

    const matching = await getContentWhere(item => item.ListItemID === listItemId);
    let deleted = 0;

    for (const item of matching) {
      await redisClient.del(`content:${item.ID}`);
      await removeFromIndex(item.ID);
      deleted++;
    }

    if (isContentDdbEnabled()) {
      // Keep DDB in sync (may delete more if Redis was out-of-sync).
      await ddbDeleteContentByListItemId(listItemId);
    }

    return res.json({
      message: `Deleted ${deleted} content item(s)`,
      deleted
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
