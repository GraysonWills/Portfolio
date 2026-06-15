const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const blogPosts = require('../services/blog-posts');
const mcpControl = require('../services/mcp-control');

const router = express.Router();

router.use((req, res, next) => requireAuth(req, res, next));

function actorFromRequest(req) {
  return {
    sub: String(req.user?.sub || req.user?.['cognito:username'] || req.user?.username || '').trim(),
    username: String(req.user?.email || req.user?.username || req.user?.sub || '').trim(),
  };
}

function getIdempotencyKey(req) {
  return String(req.headers['idempotency-key'] || '').trim();
}

async function withIdempotency(req, res, statusCode, fn) {
  const key = getIdempotencyKey(req);
  const scope = `${req.method}:${req.path}:${mcpControl.userSubFrom(req.user) || 'unknown'}`;

  if (key) {
    const replay = await mcpControl.getIdempotentResult({
      scope,
      key,
      request: req.body || {},
    });
    if (replay) {
      return res.status(replay.statusCode).json({
        ...replay.response,
        idempotentReplay: true,
      });
    }
  }

  const response = await fn();
  if (key) {
    await mcpControl.storeIdempotentResult({
      scope,
      key,
      request: req.body || {},
      response,
      statusCode,
    });
  }
  return res.status(statusCode).json(response);
}

router.get('/posts', async (req, res) => {
  try {
    const result = await blogPosts.listPosts({
      status: req.query.status || 'all',
      category: req.query.category || '',
      tag: req.query.tag || '',
      q: req.query.q || req.query.search || '',
      dateFrom: req.query.dateFrom || '',
      dateTo: req.query.dateTo || '',
      offset: req.query.offset || 0,
      limit: req.query.limit || 25,
    });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.get('/posts/:listItemID', async (req, res) => {
  try {
    const post = await blogPosts.getPost(req.params.listItemID);
    return res.json({ post });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.post('/posts', async (req, res) => {
  try {
    return await withIdempotency(req, res, 201, async () => {
      const post = await blogPosts.createPost(req.body || {}, {
        actor: actorFromRequest(req),
        source: 'authoring',
      });
      return { post };
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.put('/posts/:listItemID', async (req, res) => {
  try {
    return await withIdempotency(req, res, 200, async () => {
      const post = await blogPosts.updatePost(req.params.listItemID, req.body || {}, {
        actor: actorFromRequest(req),
        source: 'authoring',
      });
      return { post };
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.delete('/posts/:listItemID', async (req, res) => {
  try {
    return await withIdempotency(req, res, 200, async () => {
      return blogPosts.deletePost(req.params.listItemID);
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';
    return res.json(await blogPosts.listCategories({ includeArchived }));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.post('/categories', async (req, res) => {
  try {
    return await withIdempotency(req, res, 201, async () => {
      return blogPosts.createCategory(req.body || {});
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    return await withIdempotency(req, res, 200, async () => {
      const category = await blogPosts.updateCategory(req.params.id, req.body || {});
      return { category };
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    return await withIdempotency(req, res, 200, async () => {
      const category = await blogPosts.archiveCategory(req.params.id);
      return { category };
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.get('/schedules', async (_req, res) => {
  try {
    return res.json(await blogPosts.listSchedules());
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

module.exports = router;
