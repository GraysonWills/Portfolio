const requireAuth = require('./requireAuth');

function normalizeSecret(value) {
  return String(value || '').trim();
}

function buildRequestKey(req) {
  const baseUrl = String(req.baseUrl || '').replace(/\/+$/, '');
  const path = String(req.path || '');
  return `${String(req.method || 'GET').toUpperCase()} ${baseUrl}${path}`;
}

function isAllowedPublicEdgeRoute(req) {
  const key = buildRequestKey(req);
  if (
    key === 'GET /api/content/v3/bootstrap' ||
    key === 'GET /api/content/v3/landing' ||
    key === 'GET /api/content/v3/work' ||
    key === 'GET /api/content/v3/projects/categories' ||
    key === 'GET /api/content/v2/blog/cards' ||
    key === 'GET /api/content/v2/blog/cards/media' ||
    key === 'POST /api/content/v3/projects/items' ||
    key === 'POST /api/analytics/events' ||
    key === 'POST /api/subscriptions/request' ||
    key === 'POST /api/subscriptions/preferences'
  ) {
    return true;
  }

  if (key.startsWith('GET /api/content/v3/blog/')) {
    return true;
  }

  return false;
}

function requirePublicEdgeAccess(req, res, next) {
  const sharedSecret = normalizeSecret(process.env.PUBLIC_EDGE_SHARED_SECRET);
  if (!sharedSecret) {
    return next();
  }

  const provided = normalizeSecret(req.headers['x-portfolio-edge-secret']);
  if (provided && provided === sharedSecret) {
    if (!req.headers.authorization && !isAllowedPublicEdgeRoute(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  }

  if (req.headers.authorization) {
    return requireAuth(req, res, next);
  }

  return res.status(403).json({ error: 'Forbidden' });
}

module.exports = requirePublicEdgeAccess;
