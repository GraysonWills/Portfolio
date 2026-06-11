/**
 * Subscription Routes (public)
 *
 * Double opt-in subscribe + confirm + unsubscribe + preferences.
 */

const express = require('express');
const router = express.Router();
const requirePublicEdgeAccess = require('../middleware/requirePublicEdgeAccess');
const requireCommentUserAuth = require('../middleware/requireCommentUserAuth');

const {
  requestSubscription,
  confirmSubscription,
  unsubscribe,
  updatePreferences,
  getSubscriptionForEmail,
  updatePreferencesForEmail,
  unsubscribeEmail
} = require('../services/subscriptions');

function getAuthenticatedEmail(req) {
  return String(req.commentUser?.email || '').trim().toLowerCase();
}

router.post('/request', requirePublicEdgeAccess, async (req, res) => {
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

router.post('/preferences', requirePublicEdgeAccess, async (req, res) => {
  try {
    const { token, topics } = req.body || {};
    const result = await updatePreferences({ token, topics });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/me', requireCommentUserAuth, async (req, res) => {
  try {
    const result = await getSubscriptionForEmail({ email: getAuthenticatedEmail(req) });
    res.json({ subscription: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/me/preferences', requireCommentUserAuth, async (req, res) => {
  try {
    const { topics } = req.body || {};
    const result = await updatePreferencesForEmail({
      email: getAuthenticatedEmail(req),
      topics
    });
    res.json({ subscription: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/me/unsubscribe', requireCommentUserAuth, async (req, res) => {
  try {
    const result = await unsubscribeEmail({ email: getAuthenticatedEmail(req) });
    res.json({ subscription: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
