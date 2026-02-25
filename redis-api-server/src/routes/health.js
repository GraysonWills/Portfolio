/**
 * Health Check Routes
 * Provides liveness and readiness probes for monitoring / CI.
 */

const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');
const { isContentDdbEnabled, ddbPing } = require('../services/content-ddb');

/**
 * GET /api/health
 * Comprehensive health check endpoint
 */
router.get('/', async (req, res) => {
  const backend = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
  const ddbPrimary = backend === 'dynamodb' || backend === 'ddb';
  const redisConfigured = !!redisClient.isConfigured;

  try {
    const checks = await Promise.allSettled([
      (async () => {
        if (!redisConfigured) return null;
        const start = Date.now();
        await redisClient.ping();
        const redisLatency = Date.now() - start;

        let keyCount = null;
        try {
          const keys = await redisClient.keys('content:*');
          keyCount = keys.length;
        } catch (_) { /* non-critical */ }

        return { ok: true, latencyMs: redisLatency, contentKeys: keyCount };
      })(),
      (async () => {
        if (!isContentDdbEnabled()) return null;
        return await ddbPing();
      })()
    ]);

    const redisRes = checks[0].status === 'fulfilled' ? checks[0].value : null;
    const redisErr = checks[0].status === 'rejected' ? checks[0].reason : null;
    const ddbRes = checks[1].status === 'fulfilled' ? checks[1].value : null;
    const ddbErr = checks[1].status === 'rejected' ? checks[1].reason : null;

    const primaryOk = ddbPrimary ? Boolean(ddbRes?.ok) : (redisConfigured && Boolean(redisRes?.ok));
    const anyOk = (redisConfigured && Boolean(redisRes?.ok)) || Boolean(ddbRes?.ok);
    const status = primaryOk ? 'healthy' : (anyOk ? 'degraded' : 'unhealthy');

    const body = {
      status,
      version: '2.1.0',
      uptime: Math.floor(process.uptime()),
      contentBackend: backend,
      redis: !redisConfigured ? { status: 'disabled' } : (
        redisRes?.ok ? {
          status: 'connected',
          latencyMs: redisRes.latencyMs,
          contentKeys: redisRes.contentKeys
        } : {
          status: 'disconnected',
          error: redisErr ? String(redisErr?.message || redisErr) : 'unknown'
        }
      ),
      dynamodb: isContentDdbEnabled() ? (ddbRes?.ok ? {
        status: 'connected',
        latencyMs: ddbRes.latencyMs
      } : {
        status: 'disconnected',
        error: ddbErr ? String(ddbErr?.message || ddbErr) : 'unknown'
      }) : { status: 'disabled' },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      },
      timestamp: new Date().toISOString()
    };

    res.status(status === 'unhealthy' ? 503 : 200).json(body);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      version: '2.1.0',
      uptime: Math.floor(process.uptime()),
      error: error.message,
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
  const backend = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
  const ddbPrimary = backend === 'dynamodb' || backend === 'ddb';
  const redisConfigured = !!redisClient.isConfigured;

  try {
    if (ddbPrimary) {
      await ddbPing();
    } else {
      if (!redisConfigured) {
        throw new Error('Redis is not configured while CONTENT_BACKEND=redis');
      }
      await redisClient.ping();
    }
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
