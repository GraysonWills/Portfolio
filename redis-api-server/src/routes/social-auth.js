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

router.get('/:provider/accounts', requireAuth, asyncRoute(async (req, res) => {
  const result = await socialAuth.listProviderAccounts(req.params.provider, req.user);
  res.json(result);
}));

router.post('/:provider/accounts/select', requireAuth, asyncRoute(async (req, res) => {
  const result = await socialAuth.selectProviderAccount(req.params.provider, req.user, {
    accountId: req.body?.accountId
  });
  res.json(result);
}));

router.delete('/:provider', requireAuth, asyncRoute(async (req, res) => {
  const result = await socialAuth.disconnectProvider(req.params.provider, req.user);
  res.json(result);
}));

router.get('/:provider/callback', (req, res) => {
  Promise.resolve()
    .then(async () => {
      const providerError = String(req.query.error_description || req.query.error || '').trim();
      if (providerError) {
        const returnUrl = await socialAuth.buildOAuthReturnUrl(req.params.provider, {
          state: req.query.state,
          status: 'error',
          error: providerError
        });
        res.redirect(returnUrl);
        return;
      }

      const result = await socialAuth.completeOAuth(req.params.provider, {
        code: req.query.code,
        state: req.query.state
      });
      res.redirect(result.returnUrl);
    })
    .catch(async (err) => {
      const returnUrl = await socialAuth.buildOAuthReturnUrl(req.params.provider, {
        state: req.query.state,
        status: 'error',
        error: err?.message || 'Social auth callback failed'
      });
      res.redirect(returnUrl);
    });
});

module.exports = router;
