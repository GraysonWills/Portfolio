/**
 * Subscription Routes (public)
 *
 * Double opt-in subscribe + confirm + unsubscribe + preferences.
 */

const express = require('express');
const router = express.Router();

const {
  requestSubscription,
  confirmSubscription,
  unsubscribe,
  updatePreferences
} = require('../services/subscriptions');

router.post('/request', async (req, res) => {
  try {
    const { email, topics, source } = req.body || {};
    const consentIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const consentUserAgent = req.headers['user-agent'] || null;

    const result = await requestSubscription({
      email,
      topics,
      source,
      consentIp: Array.isArray(consentIp) ? consentIp[0] : consentIp,
      consentUserAgent
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/confirm', async (req, res) => {
  try {
    const token = req.query?.token;
    const result = await confirmSubscription({ token });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query?.token;
    const result = await unsubscribe({ token });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/preferences', async (req, res) => {
  try {
    const { token, topics } = req.body || {};
    const result = await updatePreferences({ token, topics });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;

