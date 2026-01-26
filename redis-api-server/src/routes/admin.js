/**
 * Admin Routes
 * Redis Cloud API management endpoints (optional)
 * Requires REDIS_CLOUD_ACCOUNT_KEY and REDIS_CLOUD_USER_KEY
 */

const express = require('express');
const router = express.Router();
const redisCloudApi = require('../utils/redis-cloud-api');

/**
 * GET /api/admin/databases
 * List all databases (requires API keys)
 */
router.get('/databases', async (req, res) => {
  try {
    const databases = await redisCloudApi.listDatabases();
    res.json(databases);
  } catch (error) {
    if (error.message.includes('not configured')) {
      res.status(503).json({ 
        error: 'Redis Cloud API keys not configured',
        message: 'Set REDIS_CLOUD_ACCOUNT_KEY and REDIS_CLOUD_USER_KEY in .env'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/admin/databases/:id
 * Get database information
 */
router.get('/databases/:id', async (req, res) => {
  try {
    const dbInfo = await redisCloudApi.getDatabaseInfo(req.params.id);
    res.json(dbInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/databases/:id/status
 * Get database status summary
 */
router.get('/databases/:id/status', async (req, res) => {
  try {
    const status = await redisCloudApi.getDatabaseStatus(req.params.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
