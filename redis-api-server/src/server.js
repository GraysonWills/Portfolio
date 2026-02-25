/**
 * Redis API Server (local / long-running)
 */

const redisClient = require('./config/redis');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp();

let server;

async function startServer() {
  try {
    if (redisClient.isConfigured) {
      await redisClient.connect();
      console.log('  Connected to Redis database');
    } else {
      console.log('  Redis disabled for this runtime');
    }

    server = app.listen(PORT, () => {
      console.log(`  Server running on port ${PORT}`);
      console.log(`  API endpoint: http://localhost:${PORT}/api`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  if (server) {
    server.close(() => console.log('  HTTP server closed'));
  }

  if (redisClient.isConfigured && redisClient.isOpen) {
    try {
      await redisClient.quit();
      console.log('  Redis connection closed');
    } catch (e) {
      console.error('  Error closing Redis:', e.message);
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
