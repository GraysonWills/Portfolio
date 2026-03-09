/**
 * Health Check Routes
 * Provides liveness and readiness probes for monitoring / CI.
 */

const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');
const { isContentDdbEnabled, ddbPing } = require('../services/content-ddb');
const { isPhotoAssetsEnabled } = require('../services/photo-assets-ddb');

/**
 * GET /api/health
 * Comprehensive health check endpoint
 */
router.get('/', async (req, res) => {
  const backend = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
  const ddbPrimary = backend === 'dynamodb' || backend === 'ddb';
  const redisConfigured = !!redisClient.isConfigured;
  const emailNotificationsEnabled = process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false';
  const schedulerInvokeRoleConfigured = !!String(process.env.SCHEDULER_INVOKE_ROLE_ARN || '').trim();
  const schedulerTargetLambdaConfigured = !!String(process.env.SCHEDULER_TARGET_LAMBDA_ARN || '').trim();
  const sesFromEmailConfigured = !!String(process.env.SES_FROM_EMAIL || '').trim();
  const photoAssetsBucketConfigured = !!String(process.env.PHOTO_ASSETS_BUCKET || process.env.S3_UPLOAD_BUCKET || '').trim();
  const photoAssetsRegionConfigured = !!String(process.env.PHOTO_ASSETS_REGION || process.env.S3_UPLOAD_REGION || process.env.AWS_REGION || '').trim();
  const photoAssetsTableConfigured = isPhotoAssetsEnabled();
  const integrationIssues = [];

  if (emailNotificationsEnabled && !sesFromEmailConfigured) {
    integrationIssues.push('SES_FROM_EMAIL missing');
  }
  if (!schedulerInvokeRoleConfigured) {
    integrationIssues.push('SCHEDULER_INVOKE_ROLE_ARN missing');
  }
  if (!schedulerTargetLambdaConfigured) {
    integrationIssues.push('SCHEDULER_TARGET_LAMBDA_ARN missing');
  }
  if (!photoAssetsBucketConfigured) {
    integrationIssues.push('PHOTO_ASSETS_BUCKET missing');
  }
  if (!photoAssetsTableConfigured) {
    integrationIssues.push('PHOTO_ASSETS_TABLE_NAME missing');
  }
  if (!photoAssetsRegionConfigured) {
    integrationIssues.push('PHOTO_ASSETS_REGION missing');
  }

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
    const status = primaryOk
      ? (integrationIssues.length ? 'degraded' : 'healthy')
      : (anyOk ? 'degraded' : 'unhealthy');

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
      integrations: {
        emailNotificationsEnabled,
        sesFromEmailConfigured,
        schedulerInvokeRoleConfigured,
        schedulerTargetLambdaConfigured,
        photoAssets: {
          bucketConfigured: photoAssetsBucketConfigured,
          regionConfigured: photoAssetsRegionConfigured,
          tableConfigured: photoAssetsTableConfigured
        },
        issues: integrationIssues
      },
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
