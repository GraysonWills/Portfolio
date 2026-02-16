/**
 * Notifications Routes (admin/auth required)
 *
 * Publish + email send controls for blog posts.
 */

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const {
  sendBlogPostNotification,
  schedulePublish,
  cancelSchedule,
  publishBlogPostNow
} = require('../services/notifications');

function requireSchedulerSecret(req, res, next) {
  const expected = process.env.SCHEDULER_WEBHOOK_SECRET || '';
  const provided = String(req.headers['x-scheduler-secret'] || '').trim();

  if (!expected || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Internal worker endpoint (invoked by scheduler Lambda).
router.post('/worker/publish', requireSchedulerSecret, async (req, res) => {
  try {
    const { listItemID, sendEmail, topic } = req.body || {};
    if (!listItemID) return res.status(400).json({ error: 'Missing listItemID' });
    const result = await publishBlogPostNow({
      listItemID,
      sendEmail: sendEmail !== false,
      topic: topic || 'blog_posts'
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Admin endpoints require Cognito auth.
router.use((req, res, next) => requireAuth(req, res, next));

router.post('/send-now', async (req, res) => {
  try {
    const { listItemID, topic } = req.body || {};
    if (!listItemID) return res.status(400).json({ error: 'Missing listItemID' });
    const result = await sendBlogPostNotification({ listItemID, topic: topic || 'blog_posts' });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/schedule', async (req, res) => {
  try {
    const { listItemID, publishAt, sendEmail, topic } = req.body || {};
    if (!listItemID) return res.status(400).json({ error: 'Missing listItemID' });
    if (!publishAt) return res.status(400).json({ error: 'Missing publishAt' });
    const result = await schedulePublish({
      listItemID,
      publishAt,
      sendEmail: sendEmail !== false,
      topic: topic || 'blog_posts'
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/schedule/:scheduleName', async (req, res) => {
  try {
    const scheduleName = req.params.scheduleName;
    const result = await cancelSchedule({ scheduleName });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
