/**
 * Blog comments service.
 *
 * Stores threaded comments in DynamoDB. Public responses omit private user
 * identifiers while keeping enough viewer-specific state for like buttons.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const { getDdbDoc } = require('./aws/clients');

const DEFAULT_COMMENTS_TABLE = 'portfolio-blog-comments';
const DEFAULT_POST_INDEX = 'PostIndex';
const MAX_COMMENT_BODY_CHARS = 3000;
const MAX_POST_ID_CHARS = 180;
const MAX_RECENT_LIMIT = 200;

function getCommentsTableName() {
  return String(process.env.COMMENTS_TABLE_NAME || DEFAULT_COMMENTS_TABLE).trim();
}

function getPostIndexName() {
  return String(process.env.COMMENTS_POST_INDEX_NAME || DEFAULT_POST_INDEX).trim();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertPostId(postId) {
  const value = String(postId || '').trim();
  if (!value) throw httpError(400, 'postId is required');
  if (value.length > MAX_POST_ID_CHARS) throw httpError(400, 'postId is too long');
  return value;
}

function normalizeCommentId(commentId) {
  const value = String(commentId || '').trim();
  if (!value) throw httpError(400, 'commentId is required');
  if (value.length > 120) throw httpError(400, 'commentId is too long');
  return value;
}

function normalizeBody(body) {
  const value = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

  if (!value) throw httpError(400, 'Comment body is required');
  if (value.length > MAX_COMMENT_BODY_CHARS) {
    throw httpError(400, `Comment body must be ${MAX_COMMENT_BODY_CHARS} characters or fewer`);
  }
  return value;
}

function clampLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_RECENT_LIMIT, Math.max(1, parsed));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function normalizeDisplayName(value) {
  const cleaned = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80);
}

function usernameFromEmail(email) {
  const value = String(email || '').trim();
  if (!value.includes('@')) return '';
  return normalizeDisplayName(value.split('@')[0].replace(/[._-]+/g, ' '));
}

function buildCommentActor(decoded, { role = 'reader' } = {}) {
  const sub = String(decoded?.sub || decoded?.['cognito:username'] || decoded?.username || '').trim();
  if (!sub) throw httpError(401, 'Comment user identity is missing');

  const email = String(decoded?.email || '').trim().toLowerCase();
  const defaultName = role === 'author'
    ? String(process.env.COMMENTS_AUTHOR_DISPLAY_NAME || 'Grayson Wills')
    : '';
  const name = normalizeDisplayName(
    defaultName
      || decoded?.preferred_username
      || decoded?.name
      || [decoded?.given_name, decoded?.family_name].filter(Boolean).join(' ')
      || usernameFromEmail(email)
      || decoded?.['cognito:username']
      || decoded?.username
      || 'Reader'
  );

  return {
    sub,
    name: name || 'Reader',
    role,
    emailHash: email ? sha256(email) : null
  };
}

function stringSetToArray(value) {
  if (!value) return [];
  if (value instanceof Set) return Array.from(value).map(String);
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function normalizeLikeCount(item) {
  const explicit = Number(item?.likeCount);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return stringSetToArray(item?.likedBy).length;
}

function isDeleted(item) {
  return String(item?.status || '').toLowerCase() === 'deleted';
}

function toPublicComment(item, viewerSub = '') {
  const likedBy = stringSetToArray(item?.likedBy);
  const deleted = isDeleted(item);

  return {
    commentId: item.commentId,
    postId: item.postId,
    parentId: item.parentId || null,
    body: deleted ? '' : String(item.body || ''),
    authorName: deleted ? 'Deleted comment' : String(item.authorName || 'Reader'),
    authorRole: item.authorRole === 'author' ? 'author' : 'reader',
    status: deleted ? 'deleted' : 'visible',
    deleted,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    likeCount: normalizeLikeCount(item),
    replyCount: Math.max(0, Number(item.replyCount) || 0),
    likedByViewer: !!(viewerSub && likedBy.includes(viewerSub)),
    viewerCanDelete: !!(viewerSub && item.authorSub === viewerSub && !deleted),
    replies: []
  };
}

function pruneDeletedLeaves(nodes) {
  return nodes
    .map((node) => ({
      ...node,
      replies: pruneDeletedLeaves(Array.isArray(node.replies) ? node.replies : [])
    }))
    .filter((node) => !node.deleted || node.replies.length > 0);
}

function buildCommentTree(items, viewerSub = '') {
  const sorted = [...items].sort((a, b) => {
    const aKey = `${a.createdAt || ''}#${a.commentId || ''}`;
    const bKey = `${b.createdAt || ''}#${b.commentId || ''}`;
    return aKey.localeCompare(bKey);
  });
  const byId = new Map();
  const roots = [];

  for (const item of sorted) {
    const comment = toPublicComment(item, viewerSub);
    byId.set(comment.commentId, comment);
  }

  for (const comment of byId.values()) {
    const parent = comment.parentId ? byId.get(comment.parentId) : null;
    if (parent) {
      parent.replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  return pruneDeletedLeaves(roots);
}

function shouldScanFallback(err) {
  return err?.name === 'ValidationException'
    || /index/i.test(String(err?.message || ''));
}

async function getComment(commentId) {
  const resp = await getDdbDoc().send(new GetCommand({
    TableName: getCommentsTableName(),
    Key: { commentId: normalizeCommentId(commentId) },
    ConsistentRead: true
  }));
  return resp?.Item || null;
}

async function scanComments({ postId = '', limit = MAX_RECENT_LIMIT } = {}) {
  const items = [];
  let ExclusiveStartKey = undefined;

  do {
    const input = {
      TableName: getCommentsTableName(),
      Limit: Math.min(100, Math.max(1, limit - items.length)),
      ExclusiveStartKey
    };

    if (postId) {
      input.FilterExpression = '#postId = :postId';
      input.ExpressionAttributeNames = { '#postId': 'postId' };
      input.ExpressionAttributeValues = { ':postId': postId };
    }

    const resp = await getDdbDoc().send(new ScanCommand(input));
    if (Array.isArray(resp?.Items)) items.push(...resp.Items);
    ExclusiveStartKey = resp?.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < limit);

  return items;
}

async function readCommentsByPost(postId) {
  const safePostId = assertPostId(postId);
  let items = [];

  try {
    let ExclusiveStartKey = undefined;
    do {
      const resp = await getDdbDoc().send(new QueryCommand({
        TableName: getCommentsTableName(),
        IndexName: getPostIndexName(),
        KeyConditionExpression: '#postId = :postId',
        ExpressionAttributeNames: { '#postId': 'postId' },
        ExpressionAttributeValues: { ':postId': safePostId },
        ExclusiveStartKey
      }));
      if (Array.isArray(resp?.Items)) items.push(...resp.Items);
      ExclusiveStartKey = resp?.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch (err) {
    if (!shouldScanFallback(err)) throw err;
    items = await scanComments({ postId: safePostId });
  }

  return items;
}

async function listCommentsByPost(postId, { viewerSub = '' } = {}) {
  const items = await readCommentsByPost(postId);
  return buildCommentTree(items, viewerSub);
}

async function listRecentComments({ limit = 100, postId = '', includeDeleted = false } = {}) {
  const safeLimit = clampLimit(limit, 100);
  const safePostId = postId ? assertPostId(postId) : '';
  const items = safePostId
    ? await readCommentsByPost(safePostId)
    : await scanComments({ limit: safeLimit });
  const publicItems = items.map((item) => toPublicComment(item));

  return publicItems
    .filter((item) => includeDeleted || !item.deleted)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, safeLimit);
}

async function createComment({ postId, parentId = null, body, decodedUser, role = 'reader' } = {}) {
  const safePostId = assertPostId(postId);
  const safeParentId = parentId ? normalizeCommentId(parentId) : null;
  const safeBody = normalizeBody(body);
  const actor = buildCommentActor(decodedUser, { role });
  const now = new Date().toISOString();
  const commentId = uuidv4();

  if (safeParentId) {
    const parent = await getComment(safeParentId);
    if (!parent) throw httpError(404, 'Parent comment not found');
    if (String(parent.postId || '') !== safePostId) {
      throw httpError(400, 'Parent comment belongs to a different post');
    }
    if (isDeleted(parent)) throw httpError(400, 'Cannot reply to a deleted comment');
  }

  const item = {
    commentId,
    postId: safePostId,
    parentId: safeParentId,
    body: safeBody,
    authorSub: actor.sub,
    authorName: actor.name,
    authorRole: actor.role,
    ...(actor.emailHash ? { authorEmailHash: actor.emailHash } : {}),
    status: 'visible',
    likeCount: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    sortKey: `${now}#${commentId}`
  };

  await getDdbDoc().send(new PutCommand({
    TableName: getCommentsTableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(commentId)'
  }));

  if (safeParentId) {
    await getDdbDoc().send(new UpdateCommand({
      TableName: getCommentsTableName(),
      Key: { commentId: safeParentId },
      UpdateExpression: 'SET #updatedAt = :now ADD #replyCount :one',
      ExpressionAttributeNames: {
        '#replyCount': 'replyCount',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':one': 1,
        ':now': now
      }
    }));
  }

  return toPublicComment(item, actor.sub);
}

async function createAdminReply({ commentId, body, decodedUser } = {}) {
  const parent = await getComment(commentId);
  if (!parent) throw httpError(404, 'Parent comment not found');
  return createComment({
    postId: parent.postId,
    parentId: parent.commentId,
    body,
    decodedUser,
    role: 'author'
  });
}

async function setCommentLike({ commentId, decodedUser, liked = true } = {}) {
  const safeCommentId = normalizeCommentId(commentId);
  const actor = buildCommentActor(decodedUser);
  const now = new Date().toISOString();
  const viewerSet = new Set([actor.sub]);

  const input = liked
    ? {
        UpdateExpression: 'SET #updatedAt = :now ADD #likedBy :viewerSet, #likeCount :one',
        ConditionExpression: '(attribute_not_exists(#status) OR #status <> :deleted) AND (attribute_not_exists(#likedBy) OR NOT contains(#likedBy, :viewerSub))',
        ExpressionAttributeValues: {
          ':viewerSet': viewerSet,
          ':viewerSub': actor.sub,
          ':one': 1,
          ':deleted': 'deleted',
          ':now': now
        }
      }
    : {
        UpdateExpression: 'SET #updatedAt = :now ADD #likeCount :minusOne DELETE #likedBy :viewerSet',
        ConditionExpression: '(attribute_not_exists(#status) OR #status <> :deleted) AND contains(#likedBy, :viewerSub)',
        ExpressionAttributeValues: {
          ':viewerSet': viewerSet,
          ':viewerSub': actor.sub,
          ':minusOne': -1,
          ':deleted': 'deleted',
          ':now': now
        }
      };

  try {
    const resp = await getDdbDoc().send(new UpdateCommand({
      TableName: getCommentsTableName(),
      Key: { commentId: safeCommentId },
      ...input,
      ExpressionAttributeNames: {
        '#likedBy': 'likedBy',
        '#likeCount': 'likeCount',
        '#status': 'status',
        '#updatedAt': 'updatedAt'
      },
      ReturnValues: 'ALL_NEW'
    }));
    return toPublicComment(resp?.Attributes || {}, actor.sub);
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    const current = await getComment(safeCommentId);
    if (!current) throw httpError(404, 'Comment not found');
    if (isDeleted(current)) throw httpError(400, 'Cannot like a deleted comment');
    return toPublicComment(current, actor.sub);
  }
}

async function softDeleteComment({ commentId, decodedUser, admin = false } = {}) {
  const safeCommentId = normalizeCommentId(commentId);
  const actor = buildCommentActor(decodedUser, { role: admin ? 'author' : 'reader' });
  const existing = await getComment(safeCommentId);
  if (!existing) throw httpError(404, 'Comment not found');
  if (!admin && existing.authorSub !== actor.sub) {
    throw httpError(403, 'You can only delete your own comments');
  }

  const now = new Date().toISOString();
  const resp = await getDdbDoc().send(new UpdateCommand({
    TableName: getCommentsTableName(),
    Key: { commentId: safeCommentId },
    UpdateExpression: 'SET #status = :deleted, #body = :empty, #deletedAt = :now, #deletedBy = :deletedBy, #updatedAt = :now',
    ConditionExpression: 'attribute_exists(commentId)',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#body': 'body',
      '#deletedAt': 'deletedAt',
      '#deletedBy': 'deletedBy',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':deleted': 'deleted',
      ':empty': '',
      ':now': now,
      ':deletedBy': admin ? 'author' : actor.sub
    },
    ReturnValues: 'ALL_NEW'
  }));

  return toPublicComment(resp?.Attributes || {}, actor.sub);
}

module.exports = {
  getCommentsTableName,
  buildCommentActor,
  buildCommentTree,
  toPublicComment,
  listCommentsByPost,
  listRecentComments,
  createComment,
  createAdminReply,
  setCommentLike,
  softDeleteComment
};
