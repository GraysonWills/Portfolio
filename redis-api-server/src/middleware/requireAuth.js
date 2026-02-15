/**
 * Cognito JWT auth middleware
 *
 * Protects write endpoints (POST/PUT/DELETE) for the blog authoring tool.
 * Read endpoints remain public so the portfolio site can fetch content.
 */

const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

function buildVerifier() {
  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!region || !userPoolId || !clientId) {
    return { configured: false };
  }

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwksUri = `${issuer}/.well-known/jwks.json`;

  const client = jwksRsa({
    jwksUri,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key.getPublicKey());
    });
  }

  return {
    configured: true,
    issuer,
    clientId,
    getKey
  };
}

const verifier = buildVerifier();

function requireAuth(req, res, next) {
  if (process.env.DISABLE_AUTH === 'true') return next();

  if (!verifier.configured) {
    return res.status(500).json({
      error: 'Auth not configured (missing COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID)'
    });
  }

  const raw = req.headers.authorization || '';
  const match = raw.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  const token = match[1];

  jwt.verify(
    token,
    verifier.getKey,
    {
      issuer: verifier.issuer,
      audience: verifier.clientId
    },
    (err, decoded) => {
      if (err) return res.status(401).json({ error: 'Unauthorized' });

      // Only accept id tokens from the user pool client.
      if (decoded && decoded.token_use && decoded.token_use !== 'id') {
        return res.status(401).json({ error: 'Invalid token_use' });
      }

      const allowListRaw = process.env.AUTH_ALLOWED_USERNAMES;
      if (allowListRaw) {
        const allowList = allowListRaw.split(',').map(s => s.trim()).filter(Boolean);
        const username = decoded?.['cognito:username'] || decoded?.username || '';
        if (!allowList.includes(username)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      req.user = decoded;
      next();
    }
  );
}

module.exports = requireAuth;
