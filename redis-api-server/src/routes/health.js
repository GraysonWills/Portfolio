/**
 * Health Check Routes
 * Provides liveness and readiness probes for monitoring / CI.
 */

const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');

/**
 * GET /api/health
 * Comprehensive health check endpoint
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  try {
    // Test Redis connection with a ping
    await redisClient.ping();
    const redisLatency = Date.now() - start;

    // Gather content key count (lightweight)
    let keyCount = 0;
    try {
      const keys = await redisClient.keys('content:*');
      keyCount = keys.length;
    } catch (_) { /* non-critical */ }

    res.json({
      status: 'healthy',
      version: '2.0.0',
      uptime: Math.floor(process.uptime()),
      redis: {
        status: 'connected',
        latencyMs: redisLatency,
        contentKeys: keyCount
      },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      version: '2.0.0',
      uptime: Math.floor(process.uptime()),
      redis: {
        status: 'disconnected',
        error: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/health/liveness
 * Lightweight liveness probe (no external dependencies)
 */
router.get('/liveness', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

/**
 * GET /api/health/readiness
 * Readiness probe — only 200 if Redis is reachable
 */
router.get('/readiness', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
