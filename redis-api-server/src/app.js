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
const rateLimit = require('express-rate-limit');

const contentRoutes = require('./routes/content');
const uploadRoutes = require('./routes/upload');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');

function createApp() {
  const app = express();

  // ─── Security ────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for portfolio
    crossOriginEmbedderPolicy: false
  }));

  // ─── CORS ────────────────────────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : ['http://localhost:4200', 'http://localhost:3000'];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, health checks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
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
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use('/api/', apiLimiter);

  // Stricter rate limit for writes
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Write rate limit exceeded. Please try again later.' }
  });

  // ─── Body Parsing ────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ─── In-Memory Response Cache (for GET endpoints) ────────────
  const cache = new Map();
  const CACHE_TTL = parseInt(process.env.CACHE_TTL_MS, 10) || 60_000;

  function cacheMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const key = req.originalUrl;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.set('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const originalJson = res.json.bind(res);
    res.json = (data) => {
      cache.set(key, { data, timestamp: Date.now() });
      res.set('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  }

  function invalidateCache(req, res, next) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      cache.clear();
    }
    next();
  }

  app.use(invalidateCache);

  // ─── Routes ──────────────────────────────────────────────────
  app.use('/api/health', healthRoutes);
  app.use('/api/content', cacheMiddleware, contentRoutes);
  app.use('/api/upload', writeLimiter, uploadRoutes);
  app.use('/api/admin', writeLimiter, adminRoutes);

  app.get('/', (req, res) => {
    res.json({
      message: 'Redis API Server',
      version: '2.1.0',
      uptime: Math.floor(process.uptime()) + 's',
      endpoints: {
        health: '/api/health',
        content: '/api/content',
        upload: '/api/upload',
        admin: '/api/admin (requires API keys)'
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

