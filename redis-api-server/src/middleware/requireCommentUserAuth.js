/**
 * Cognito JWT auth for public comment actions.
 *
 * This intentionally does not use AUTH_ALLOWED_USERNAMES. Commenters are normal
 * verified site users, while authoring/admin routes keep using requireAuth.
 */

const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getCommentAuthConfig() {
  const region = process.env.COMMENTS_COGNITO_REGION || process.env.COGNITO_REGION;
  const userPoolId = process.env.COMMENTS_COGNITO_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID;
  const clientIds = splitCsv(
    process.env.COMMENTS_COGNITO_CLIENT_IDS
      || process.env.COMMENTS_COGNITO_CLIENT_ID
      || process.env.COGNITO_CLIENT_ID
  );

  if (!region || !userPoolId || !clientIds.length) {
    return { configured: false };
  }

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const client = jwksRsa({
    jwksUri: `${issuer}/.well-known/jwks.json`,
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
    audience: clientIds.length === 1 ? clientIds[0] : clientIds,
    getKey
  };
}

const verifier = getCommentAuthConfig();

function extractBearerToken(req) {
  const raw = req.headers.authorization || '';
  const match = raw.match(/^Bearer (.+)$/);
  return match ? match[1] : '';
}

function isEmailVerificationRequired() {
  return process.env.COMMENTS_REQUIRE_VERIFIED_EMAIL !== 'false';
}

function isEmailVerified(decoded) {
  return decoded?.email_verified === true || decoded?.email_verified === 'true';
}

function verifyCommentUserToken(req) {
  if (process.env.DISABLE_AUTH === 'true') {
    return Promise.resolve({
      sub: 'local-comment-user',
      'cognito:username': 'local-comment-user',
      email_verified: true
    });
  }

  if (!verifier.configured) {
    const err = new Error(
      'Comment auth not configured (missing COMMENTS_COGNITO_* or COGNITO_* env vars)'
    );
    err.status = 500;
    return Promise.reject(err);
  }

  const token = extractBearerToken(req);
  if (!token) {
    const err = new Error('Missing Authorization bearer token');
    err.status = 401;
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      verifier.getKey,
      {
        issuer: verifier.issuer,
        audience: verifier.audience
      },
      (err, decoded) => {
        if (err) {
          const authErr = new Error('Unauthorized');
          authErr.status = 401;
          reject(authErr);
          return;
        }

        if (decoded && decoded.token_use && decoded.token_use !== 'id') {
          const tokenUseErr = new Error('Invalid token_use');
          tokenUseErr.status = 401;
          reject(tokenUseErr);
          return;
        }

        if (isEmailVerificationRequired() && !isEmailVerified(decoded)) {
          const verifiedErr = new Error('Email verification is required to comment');
          verifiedErr.status = 403;
          reject(verifiedErr);
          return;
        }

        resolve(decoded);
      }
    );
  });
}

function requireCommentUserAuth(req, res, next) {
  verifyCommentUserToken(req)
    .then((decoded) => {
      req.commentUser = decoded;
      next();
    })
    .catch((err) => {
      res.status(err.status || 401).json({ error: err.message || 'Unauthorized' });
    });
}

function optionalCommentUserAuth(req, res, next) {
  if (!extractBearerToken(req)) return next();

  verifyCommentUserToken(req)
    .then((decoded) => {
      req.commentUser = decoded;
      next();
    })
    .catch(() => next());
}

module.exports = requireCommentUserAuth;
module.exports.optionalCommentUserAuth = optionalCommentUserAuth;
module.exports.verifyCommentUserToken = verifyCommentUserToken;
