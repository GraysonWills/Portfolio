/**
 * Redis Cloud REST API Client
 * For management operations (not data operations)
 * Uses API key authentication
 */

const https = require('https');

const REDIS_CLOUD_API_BASE = 'https://api.redislabs.com/v1';

/**
 * Make authenticated request to Redis Cloud API
 */
async function makeApiRequest(endpoint, method = 'GET', body = null) {
  const accountKey = process.env.REDIS_CLOUD_ACCOUNT_KEY;
  const userKey = process.env.REDIS_CLOUD_USER_KEY;

  if (!accountKey || !userKey) {
    throw new Error('Redis Cloud API keys not configured. Set REDIS_CLOUD_ACCOUNT_KEY and REDIS_CLOUD_USER_KEY');
  }

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, REDIS_CLOUD_API_BASE);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'x-api-key': accountKey,
        'x-api-secret-key': userKey,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      const bodyString = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`API Error: ${res.statusCode} - ${parsed.message || data}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`API Error: ${res.statusCode} - ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Get database information
 */
async function getDatabaseInfo(databaseId) {
  return makeApiRequest(`/databases/${databaseId}`);
}

/**
 * List all databases
 */
async function listDatabases() {
  return makeApiRequest('/databases');
}

/**
 * Get database status
 */
async function getDatabaseStatus(databaseId) {
  const db = await getDatabaseInfo(databaseId);
  return {
    id: db.uid,
    name: db.name,
    status: db.status,
    endpoint: db.publicEndpoint,
    port: db.port,
    memoryLimit: db.memoryLimit,
    memoryUsed: db.memoryUsed
  };
}

/**
 * Get database credentials (endpoint, port, password)
 * Note: Redis Cloud API typically doesn't return passwords for security reasons
 * This returns the connection info, but password must be set separately
 */
async function getDatabaseConnectionInfo(databaseId) {
  const db = await getDatabaseInfo(databaseId);
  return {
    host: db.publicEndpoint || db.endpoint,
    port: db.port,
    ssl: db.ssl || db.tls || false,
    // Note: Password is not returned by API for security - must use existing password
    requiresPassword: true
  };
}

module.exports = {
  makeApiRequest,
  getDatabaseInfo,
  listDatabases,
  getDatabaseStatus,
  getDatabaseConnectionInfo
};
