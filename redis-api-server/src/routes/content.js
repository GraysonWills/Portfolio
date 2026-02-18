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

const CONTENT_BACKEND = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
const useDdbAsPrimary = CONTENT_BACKEND === 'dynamodb' || CONTENT_BACKEND === 'ddb';

// Public reads; authenticated writes.
router.use((req, res, next) => {
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
      return res.json(contents);
    }

    try {
      const contents = await getAllContent();
      return res.json(contents);
    } catch (err) {
      // Redis down? Fall back to DynamoDB if configured.
      if (isContentDdbEnabled()) {
        const contents = await ddbScanAllContent();
        return res.json(contents);
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      return res.json(contents);
    }

    try {
      const contents = await getContentWhere(item => item.PageID === pageId);
      return res.json(contents);
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByPageId(pageId);
        return res.json(contents);
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
      return res.json(contents);
    }

    try {
      const contents = await getContentWhere(
        item => item.PageID === pageId && item.PageContentID === contentId
      );
      return res.json(contents);
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByPageAndContentId(pageId, contentId);
        return res.json(contents);
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
      return res.json(contents);
    }

    try {
      const contents = await getContentWhere(item => item.ListItemID === listItemId);
      return res.json(contents);
    } catch (err) {
      if (isContentDdbEnabled()) {
        const contents = await ddbGetContentByListItemId(listItemId);
        return res.json(contents);
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
      return res.json(content);
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

    res.json(content);
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
