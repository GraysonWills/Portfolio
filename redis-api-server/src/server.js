/**
 * Redis API Server
 * Express backend API that connects to Redis database
 * and provides REST endpoints for portfolio and blog content.
 *
 * Enhancements:
 *  - Helmet for security headers
 *  - Compression for response bodies
 *  - Morgan for structured request logging
 *  - express-rate-limit to prevent abuse
 *  - In-memory response cache for GET endpoints
 *  - Graceful shutdown with connection draining
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const redisClient = require('./config/redis');
const contentRoutes = require('./routes/content');
const uploadRoutes = require('./routes/upload');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for portfolio
  crossOriginEmbedderPolicy: false
}));

// ─── CORS ───────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
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

// ─── Compression ────────────────────────────────────────────────
app.use(compression({
  threshold: 1024, // Only compress responses > 1KB
  level: 6
}));

// ─── Request Logging ────────────────────────────────────────────
const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(logFormat));

// ─── Rate Limiting ──────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,                  // limit each IP to 200 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Stricter rate limit for write operations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Write rate limit exceeded. Please try again later.' }
});

// ─── Body Parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── In-Memory Response Cache (for GET endpoints) ───────────────
const cache = new Map();
const CACHE_TTL = parseInt(process.env.CACHE_TTL_MS, 10) || 60_000; // 60s default

function cacheMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();

  const key = req.originalUrl;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    res.set('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  // Intercept res.json to store in cache
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    cache.set(key, { data, timestamp: Date.now() });
    res.set('X-Cache', 'MISS');
    return originalJson(data);
  };

  next();
}

// Invalidate cache on write operations
function invalidateCache(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    cache.clear();
  }
  next();
}

app.use(invalidateCache);

// ─── Routes ─────────────────────────────────────────────────────
app.use('/api/health', healthRoutes);
app.use('/api/content', cacheMiddleware, contentRoutes);
app.use('/api/upload', writeLimiter, uploadRoutes);
app.use('/api/admin', writeLimiter, adminRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Redis API Server',
    version: '2.0.0',
    uptime: Math.floor(process.uptime()) + 's',
    endpoints: {
      health: '/api/health',
      content: '/api/content',
      upload: '/api/upload',
      admin: '/api/admin (requires API keys)'
    }
  });
});

// ─── 404 Handler ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ─── Error Handling Middleware ───────────────────────────────────
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

// ─── Server Startup ─────────────────────────────────────────────
let server;

async function startServer() {
  try {
    await redisClient.connect();
    console.log('  Connected to Redis database');

    server = app.listen(PORT, () => {
      console.log(`  Server running on port ${PORT}`);
      console.log(`  API endpoint: http://localhost:${PORT}/api`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  Cache TTL: ${CACHE_TTL}ms`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// ─── Graceful Shutdown ──────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => console.log('  HTTP server closed'));
  }

  // Disconnect Redis
  try {
    await redisClient.quit();
    console.log('  Redis connection closed');
  } catch (e) {
    console.error('  Error closing Redis:', e.message);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
