/**
 * Blog comment routes.
 */

const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const requireCommentUserAuth = require('../middleware/requireCommentUserAuth');
const { optionalCommentUserAuth } = require('../middleware/requireCommentUserAuth');
const {
  createAdminReply,
  createComment,
  listCommentsByPost,
  listRecentComments,
  setCommentLike,
  softDeleteComment
} = require('../services/comments');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      const status = err.status || 500;
      const message = status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message;
      console.error(`[comments] ${req.method} ${req.originalUrl}:`, err.message);
      res.status(status).json({ error: message || 'Comment request failed' });
    });
  };
}

function parseBoolean(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

router.get('/post/:postId', optionalCommentUserAuth, asyncRoute(async (req, res) => {
  const comments = await listCommentsByPost(req.params.postId, {
    viewerSub: req.commentUser?.sub || ''
  });
  res.json({
    postId: req.params.postId,
    count: comments.length,
    comments
  });
}));

router.post('/post/:postId', requireCommentUserAuth, asyncRoute(async (req, res) => {
  const comment = await createComment({
    postId: req.params.postId,
    parentId: req.body?.parentId || null,
    body: req.body?.body,
    decodedUser: req.commentUser
  });
  res.status(201).json({ comment });
}));

router.post('/:commentId/like', requireCommentUserAuth, asyncRoute(async (req, res) => {
  const liked = req.body?.liked !== false;
  const comment = await setCommentLike({
    commentId: req.params.commentId,
    decodedUser: req.commentUser,
    liked
  });
  res.json({ comment });
}));

router.delete('/:commentId', requireCommentUserAuth, asyncRoute(async (req, res) => {
  const comment = await softDeleteComment({
    commentId: req.params.commentId,
    decodedUser: req.commentUser,
    admin: false
  });
  res.json({ comment });
}));

router.get('/admin/recent', requireAuth, asyncRoute(async (req, res) => {
  const comments = await listRecentComments({
    limit: req.query.limit,
    postId: req.query.postId,
    includeDeleted: parseBoolean(req.query.includeDeleted)
  });
  res.json({
    count: comments.length,
    comments
  });
}));

router.post('/admin/:commentId/reply', requireAuth, asyncRoute(async (req, res) => {
  const comment = await createAdminReply({
    commentId: req.params.commentId,
    body: req.body?.body,
    decodedUser: req.user
  });
  res.status(201).json({ comment });
}));

router.delete('/admin/:commentId', requireAuth, asyncRoute(async (req, res) => {
  const comment = await softDeleteComment({
    commentId: req.params.commentId,
    decodedUser: req.user,
    admin: true
  });
  res.json({ comment });
}));

module.exports = router;
