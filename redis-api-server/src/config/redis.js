/**
 * Redis Client Configuration
 */

const { createClient } = require('redis');

// Parse Redis Cloud host and port from endpoint if provided
// Default to empty to force explicit configuration (Redis Cloud, not local)
let redisHost = process.env.REDIS_HOST || '';
let redisPort = parseInt(process.env.REDIS_PORT || '15545'); // Default to Redis Cloud port

// If REDIS_ENDPOINT is provided, parse it (format: host:port)
if (process.env.REDIS_ENDPOINT && !process.env.REDIS_HOST) {
  const [host, port] = process.env.REDIS_ENDPOINT.split(':');
  redisHost = host;
  redisPort = parseInt(port || '6379');
}

// Redis connection configuration from environment variables
// Only enable TLS when explicitly set in .env (REDIS_TLS=true)
const requiresTLS = process.env.REDIS_TLS === 'true';

const redisConfig = {
  socket: {
    host: redisHost,
    port: redisPort,
    tls: requiresTLS,
    // Redis Cloud TLS configuration
    ...(requiresTLS && {
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false'
    })
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0')
};

// Log connection type
if (requiresTLS) {
  console.log(`Connecting to Redis Cloud with TLS at ${redisHost}:${redisPort}`);
} else {
  console.log(`Connecting to Redis at ${redisHost}:${redisPort} (no TLS)`);
}

// Validate configuration
if (!redisHost) {
  console.error('Error: REDIS_HOST environment variable is required');
  console.error('Please configure your Redis Cloud connection in .env file');
  console.error('Example: REDIS_HOST=redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com');
  process.exit(1);
}

if (!process.env.REDIS_PASSWORD) {
  console.error('Error: REDIS_PASSWORD environment variable is required');
  console.error('Please configure your Redis Cloud password in .env file');
  process.exit(1);
}

// Create Redis client
const redisClient = createClient(redisConfig);

// Error handling
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log(`Connecting to Redis at ${redisHost}:${redisPort}...`);
});

redisClient.on('ready', () => {
  console.log('Redis client ready');
});

module.exports = redisClient;
