/**
 * Analytics ingestion routes.
 *
 * Public endpoint used by portfolio frontend to send batched interaction events.
 */

const express = require('express');
const router = express.Router();
const { enqueueAnalyticsEvents } = require('../services/analytics');

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || req.ip || '';
}

router.post('/events', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const events = Array.isArray(body.events) ? body.events : [body];

    const requestContext = {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      referrer: req.headers.referer || req.headers.referrer || '',
      route: body.route || ''
    };

    const result = await enqueueAnalyticsEvents(events, requestContext);
    return res.status(202).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;

