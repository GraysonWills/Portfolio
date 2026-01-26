/**
 * Redis API Server
 * Express backend API that connects to Redis database
 * and provides REST endpoints for portfolio and blog content
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const redisClient = require('./config/redis');
const contentRoutes = require('./routes/content');
const uploadRoutes = require('./routes/upload');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Redis API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      content: '/api/content',
      upload: '/api/upload',
      admin: '/api/admin (requires API keys)'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    status: err.status || 500
  });
});

// Start server
async function startServer() {
  try {
    // Test Redis connection
    await redisClient.connect();
    console.log('✓ Connected to Redis database');
    
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ API endpoint: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await redisClient.quit();
  process.exit(0);
});
