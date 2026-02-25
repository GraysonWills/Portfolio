/**
 * Redis Client Configuration
 */

const { createClient } = require('redis');

// Parse Redis Cloud host and port from endpoint if provided
// Default to empty so Redis can be optionally disabled.
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
const redisConfigured = Boolean(redisHost);

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

function createDisabledRedisClient() {
  const disabledError = () => new Error('Redis is not configured for this runtime');
  return {
    isConfigured: false,
    isOpen: false,
    isReady: false,
    on: () => {},
    connect: async () => {},
    quit: async () => {},
    ping: async () => { throw disabledError(); },
    get: async () => { throw disabledError(); },
    set: async () => { throw disabledError(); },
    del: async () => { throw disabledError(); },
    exists: async () => { throw disabledError(); },
    expire: async () => { throw disabledError(); },
    keys: async () => { throw disabledError(); },
    scan: async () => { throw disabledError(); },
    sAdd: async () => { throw disabledError(); },
    sRem: async () => { throw disabledError(); },
    sMembers: async () => { throw disabledError(); },
    json: {
      get: async () => { throw disabledError(); },
      set: async () => { throw disabledError(); }
    }
  };
}

let redisClient;

if (redisConfigured) {
  // Log connection type
  if (requiresTLS) {
    console.log(`Redis enabled (TLS) at ${redisHost}:${redisPort}`);
  } else {
    console.log(`Redis enabled at ${redisHost}:${redisPort} (no TLS)`);
  }

  redisClient = createClient(redisConfig);
  redisClient.isConfigured = true;

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
} else {
  console.log('Redis disabled: REDIS_HOST is not set');
  redisClient = createDisabledRedisClient();
}

module.exports = redisClient;
module.exports.isRedisConfigured = () => redisConfigured;
