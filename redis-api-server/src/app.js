/**
 * Express app factory
 *
 * Used by both local server (`src/server.js`) and AWS Lambda (`src/lambda.js`).
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const contentRoutes = require('./routes/content');
const uploadRoutes = require('./routes/upload');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');
const subscriptionsRoutes = require('./routes/subscriptions');
const notificationsRoutes = require('./routes/notifications');
const analyticsRoutes = require('./routes/analytics');
const photoAssetsRoutes = require('./routes/photo-assets');
const mediaRoutes = require('./routes/media');
const resumeRoutes = require('./routes/resume');
const commentsRoutes = require('./routes/comments');

function createApp() {
  const app = express();

  function isPublicContentCacheable(req) {
    if (String(req.method || '').toUpperCase() !== 'GET') return false;
    if (req.headers.authorization) return false;

    const path = String(req.path || '').replace(/\/+$/, '');
    if (path === '/content/v3/bootstrap') return true;
    if (path === '/content/v3/landing') return true;
    if (path === '/content/v3/work') return true;
    if (path === '/content/v3/projects/categories') return true;
    if (path === '/content/v2/blog/cards') return true;
    if (path === '/content/v2/blog/cards/media') return true;
    if (path.startsWith('/content/v3/blog/')) return true;
    return false;
  }

  function getPublicReadCacheControl() {
    return String(
      process.env.PUBLIC_READ_CACHE_CONTROL
      || 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
    ).trim();
  }

  function normalizeOrigin(origin) {
    const raw = String(origin || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host.toLowerCase()}`;
    } catch {
      return raw.toLowerCase();
    }
  }

  function expandAllowedOrigins(origins) {
    const expanded = new Set();
    for (const origin of origins) {
      const normalized = normalizeOrigin(origin);
      if (!normalized) continue;
      expanded.add(normalized);

      // Keep apex + www in sync for public site origins.
      try {
        const u = new URL(normalized);
        if (u.hostname.startsWith('www.')) {
          expanded.add(`${u.protocol}//${u.hostname.slice(4)}${u.port ? `:${u.port}` : ''}`);
        } else if (u.hostname.split('.').length === 2 && !u.hostname.includes('localhost')) {
          expanded.add(`${u.protocol}//www.${u.hostname}${u.port ? `:${u.port}` : ''}`);
        }
      } catch {
        // Ignore malformed values; they're already normalized and added above.
      }
    }
    return expanded;
  }

  function getClientIp(req) {
    // X-Forwarded-For is a client -> proxy chain. Use the first entry as viewer IP.
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      const parts = xff.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length) return parts[0];
    }
    return req.socket?.remoteAddress || req.ip || 'unknown';
  }

  // ─── Security ────────────────────────────────────────────────
  // Reduce passive fingerprinting.
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for portfolio
    crossOriginEmbedderPolicy: false,
    // Allow cross-origin image embedding for media served from api.* used by www.*
    crossOriginResourcePolicy: false
  }));

  // ─── CORS ────────────────────────────────────────────────────
  const baselineOrigins = [
    'http://localhost:4200',
    'http://localhost:4300',
    'http://localhost:4301',
    'http://localhost:3000',
    'https://author.grayson-wills.com',
    'https://d39s45clv1oor3.cloudfront.net'
  ];
  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const allowedOrigins = expandAllowedOrigins([
    ...baselineOrigins,
    ...configuredOrigins
  ]);

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, health checks)
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOrigins.has(normalizedOrigin)) return callback(null, true);
      // Return normal response without CORS headers rather than throwing 500.
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true
  }));

  // ─── Compression ─────────────────────────────────────────────
  app.use(compression({
    threshold: 1024,
    level: 6
  }));

  // ─── Request Logging ────────────────────────────────────────
  const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
  app.use(morgan(logFormat));

  // ─── Rate Limiting ──────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    skip: (req) => req.path.startsWith('/analytics/events'),
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use('/api/', apiLimiter);

  // Stricter rate limit for writes
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    message: { error: 'Write rate limit exceeded. Please try again later.' }
  });

  // Analytics endpoint has its own higher-throughput limiter and stays public.
  const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    message: { error: 'Analytics rate limit exceeded. Please try again later.' }
  });

  const resumeLimiter = rateLimit({
    windowMs: 5 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    message: { error: 'Resume download is cooling down. Please wait a few seconds.' }
  });

  // ─── Body Parsing ────────────────────────────────────────────
  // Keep request size bounded to reduce abuse blast radius.
  const requestBodyLimit = String(process.env.REQUEST_BODY_LIMIT || '6mb').trim() || '6mb';
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit, parameterLimit: 1000 }));

  // ─── Dynamic API Cache Policy ────────────────────────────────
  // Mutable/admin/comment traffic stays fresh. Published public content reads
  // get a short shared-cache window to reduce repeat Lambda/DynamoDB work.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') {
      if (isPublicContentCacheable(req)) {
        res.set('Cache-Control', getPublicReadCacheControl());
        res.set('Vary', 'Accept-Encoding');
      } else {
        res.set('Cache-Control', 'no-store, max-age=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }
    next();
  });

  // ─── Routes ──────────────────────────────────────────────────
  app.use('/api/health', healthRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/upload', writeLimiter, uploadRoutes);
  app.use('/api/admin', writeLimiter, adminRoutes);
  app.use('/api/subscriptions', writeLimiter, subscriptionsRoutes);
  app.use('/api/notifications', writeLimiter, notificationsRoutes);
  app.use('/api/analytics', analyticsLimiter, analyticsRoutes);
  app.use('/api/photo-assets', writeLimiter, photoAssetsRoutes);
  app.use('/api/resume', resumeLimiter, resumeRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/media', mediaRoutes);

  app.get('/', (req, res) => {
    res.json({
      message: 'Redis API Server',
      version: '2.1.0',
      uptime: Math.floor(process.uptime()) + 's',
      endpoints: {
        health: '/api/health',
        content: '/api/content',
        upload: '/api/upload',
        admin: '/api/admin (requires API keys)',
        subscriptions: '/api/subscriptions',
        notifications: '/api/notifications (requires auth)',
        analytics: '/api/analytics/events (public)',
        resume: '/api/resume/download (public, rate limited)',
        comments: '/api/comments',
        photoAssets: '/api/photo-assets (requires auth)',
        media: '/media/:key (public S3 proxy)'
      }
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.originalUrl });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;

    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);

    res.status(status).json({
      error: message,
      status,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
  });

  return app;
}

module.exports = { createApp };
