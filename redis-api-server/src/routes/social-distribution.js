const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const socialDistribution = require('../services/social-distribution');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      res.status(err.status || 500).json({
        error: err?.message || 'Social distribution request failed',
        ...(err?.details ? { details: err.details } : {})
      });
    });
  };
}

router.use((req, res, next) => requireAuth(req, res, next));

router.get('/settings', asyncRoute(async (req, res) => {
  const settings = await socialDistribution.getSettings(req.user);
  res.json(settings);
}));

router.put('/settings', asyncRoute(async (req, res) => {
  const settings = await socialDistribution.saveSettings(req.user, req.body || {});
  res.json(settings);
}));

router.get('/deliveries', asyncRoute(async (req, res) => {
  const result = await socialDistribution.listDeliveries(req.user, {
    limit: req.query?.limit
  });
  res.json(result);
}));

router.post('/deliveries/:deliveryId/send', asyncRoute(async (req, res) => {
  const delivery = await socialDistribution.sendDeliveryForUser(req.user, req.params.deliveryId, {
    force: req.body?.force !== false
  });
  res.json({ delivery });
}));

router.delete('/deliveries/:deliveryId', asyncRoute(async (req, res) => {
  const result = await socialDistribution.deleteDeliveryForUser(req.user, req.params.deliveryId);
  res.json(result);
}));

module.exports = router;
