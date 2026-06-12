const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const socialAuth = require('../services/social-auth');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      const status = Number(err?.status || 500);
      res.status(status).json({
        error: err?.message || 'Social auth request failed',
        ...(err?.details ? { details: err.details } : {})
      });
    });
  };
}

router.get('/status', requireAuth, asyncRoute(async (req, res) => {
  const providers = await socialAuth.getProviderStatus(req.user);
  res.json({ providers });
}));

router.post('/:provider/start', requireAuth, asyncRoute(async (req, res) => {
  const result = await socialAuth.startOAuth(req.params.provider, req.user, {
    returnUrl: req.body?.returnUrl
  });
  res.json(result);
}));

router.delete('/:provider', requireAuth, asyncRoute(async (req, res) => {
  const result = await socialAuth.disconnectProvider(req.params.provider, req.user);
  res.json(result);
}));

router.get('/:provider/callback', asyncRoute(async (req, res) => {
  const result = await socialAuth.completeOAuth(req.params.provider, {
    code: req.query.code,
    state: req.query.state
  });
  res.redirect(result.returnUrl);
}));

module.exports = router;
