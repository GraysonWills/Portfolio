const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCommentActor,
  buildCommentTree,
  toPublicComment
} = require('../src/services/comments');

test('buildCommentTree nests replies and prunes deleted leaves', () => {
  const items = [
    {
      commentId: 'root-1',
      postId: 'blog-1',
      body: 'Root',
      authorSub: 'reader-1',
      authorName: 'Reader One',
      status: 'visible',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      commentId: 'reply-1',
      postId: 'blog-1',
      parentId: 'root-1',
      body: 'Reply',
      authorSub: 'reader-2',
      authorName: 'Reader Two',
      status: 'visible',
      createdAt: '2026-01-01T00:01:00.000Z'
    },
    {
      commentId: 'deleted-leaf',
      postId: 'blog-1',
      body: '',
      authorSub: 'reader-3',
      authorName: 'Reader Three',
      status: 'deleted',
      createdAt: '2026-01-01T00:02:00.000Z'
    }
  ];

  const tree = buildCommentTree(items, 'reader-2');

  assert.equal(tree.length, 1);
  assert.equal(tree[0].commentId, 'root-1');
  assert.equal(tree[0].replies.length, 1);
  assert.equal(tree[0].replies[0].commentId, 'reply-1');
});

test('toPublicComment hides private likedBy values and marks viewer likes', () => {
  const publicComment = toPublicComment({
    commentId: 'comment-1',
    postId: 'blog-1',
    body: 'Hello',
    authorSub: 'reader-1',
    authorName: 'Reader One',
    status: 'visible',
    likedBy: new Set(['reader-2']),
    likeCount: 1
  }, 'reader-2');

  assert.equal(publicComment.likedByViewer, true);
  assert.equal(publicComment.likeCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(publicComment, 'likedBy'), false);
});

test('buildCommentActor uses author display override for admin replies', () => {
  const previous = process.env.COMMENTS_AUTHOR_DISPLAY_NAME;
  process.env.COMMENTS_AUTHOR_DISPLAY_NAME = 'Site Author';

  try {
    const actor = buildCommentActor({
      sub: 'admin-sub',
      email: 'author@example.com',
      preferred_username: 'ignored'
    }, { role: 'author' });

    assert.equal(actor.sub, 'admin-sub');
    assert.equal(actor.role, 'author');
    assert.equal(actor.name, 'Site Author');
    assert.ok(actor.emailHash);
  } finally {
    if (typeof previous === 'undefined') {
      delete process.env.COMMENTS_AUTHOR_DISPLAY_NAME;
    } else {
      process.env.COMMENTS_AUTHOR_DISPLAY_NAME = previous;
    }
  }
});
