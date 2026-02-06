/**
 * Content Routes
 * Handles all Redis content operations
 */

const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /api/content
 * Get all content from Redis
 */
router.get('/', async (req, res) => {
  try {
    const keys = await redisClient.keys('content:*');
    const contents = [];
    
    for (const key of keys) {
      const content = await redisClient.json.get(key);
      if (content) {
        contents.push(content);
      }
    }
    
    res.json(contents);
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
    const keys = await redisClient.keys('content:*');
    const contents = [];
    
    for (const key of keys) {
      let content;
      try {
        content = await redisClient.json.get(key);
      } catch (err) {
        const str = await redisClient.get(key);
        if (str) content = JSON.parse(str);
      }
      if (content && content.PageID === pageId) {
        contents.push(content);
      }
    }
    
    res.json(contents);
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
    const keys = await redisClient.keys('content:*');
    const contents = [];
    
    for (const key of keys) {
      let content;
      try {
        content = await redisClient.json.get(key);
      } catch (err) {
        const str = await redisClient.get(key);
        if (str) content = JSON.parse(str);
      }
      if (content && content.PageID === pageId && content.PageContentID === contentId) {
        contents.push(content);
      }
    }
    
    res.json(contents);
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
    const keys = await redisClient.keys('content:*');
    const contents = [];
    
    for (const key of keys) {
      let content;
      try {
        content = await redisClient.json.get(key);
      } catch (err) {
        const str = await redisClient.get(key);
        if (str) content = JSON.parse(str);
      }
      if (content && content.ListItemID === listItemId) {
        contents.push(content);
      }
    }
    
    res.json(contents);
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
    const key = `content:${req.params.id}`;
    let content;
    
    try {
      content = await redisClient.json.get(key);
    } catch (err) {
      const str = await redisClient.get(key);
      if (str) content = JSON.parse(str);
    }
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
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
    
    // Generate ID if not provided
    if (!content.ID) {
      content.ID = uuidv4();
    }
    
    // Set timestamps
    if (!content.CreatedAt) {
      content.CreatedAt = new Date().toISOString();
    }
    content.UpdatedAt = new Date().toISOString();
    
    const key = `content:${content.ID}`;
    try {
      // Try Redis JSON first
      await redisClient.json.set(key, '$', content);
    } catch (err) {
      // Fallback to string storage
      await redisClient.set(key, JSON.stringify(content));
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
      // Generate ID if not provided
      if (!content.ID) {
        content.ID = uuidv4();
      }
      
      // Set timestamps
      if (!content.CreatedAt) {
        content.CreatedAt = new Date().toISOString();
      }
      content.UpdatedAt = new Date().toISOString();
      
      const key = `content:${content.ID}`;
      try {
        await redisClient.json.set(key, '$', content);
      } catch (err) {
        await redisClient.set(key, JSON.stringify(content));
      }
      created.push(content);
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
    const key = `content:${req.params.id}`;
    let existing;
    
    try {
      existing = await redisClient.json.get(key);
    } catch (err) {
      const str = await redisClient.get(key);
      if (str) existing = JSON.parse(str);
    }
    
    if (!existing) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    const updated = {
      ...existing,
      ...req.body,
      ID: req.params.id, // Ensure ID doesn't change
      UpdatedAt: new Date().toISOString()
    };
    
    try {
      await redisClient.json.set(key, '$', updated);
    } catch (err) {
      await redisClient.set(key, JSON.stringify(updated));
    }
    
    res.json(updated);
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
    const key = `content:${req.params.id}`;
    const exists = await redisClient.exists(key);
    
    if (!exists) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    await redisClient.del(key);
    res.json({ message: 'Content deleted successfully' });
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
    const keys = await redisClient.keys('content:*');
    let deleted = 0;
    
    for (const key of keys) {
      let content;
      try {
        content = await redisClient.json.get(key);
      } catch (err) {
        const str = await redisClient.get(key);
        if (str) content = JSON.parse(str);
      }
      if (content && content.ListItemID === listItemId) {
        await redisClient.del(key);
        deleted++;
      }
    }
    
    res.json({ 
      message: `Deleted ${deleted} content item(s)`,
      deleted: deleted
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
