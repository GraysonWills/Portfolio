const crypto = require('crypto');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const blogPosts = require('./blog-posts');
const comments = require('./comments');
const mcpControl = require('./mcp-control');
const socialAuth = require('./social-auth');
const socialDistribution = require('./social-distribution');
const notifications = require('./notifications');
const {
  ddbGetContentById,
  ddbPutContent,
  ddbScanAllContent,
} = require('./content-ddb');
const {
  createPendingPhotoAsset,
  deletePhotoAssetRecord,
  getPhotoAssetById,
  isPhotoAssetsEnabled,
  listPhotoAssets,
  markPhotoAssetDeleted,
  markPhotoAssetReady,
} = require('./photo-assets-ddb');
const { getAwsRegion } = require('./aws/clients');
const { putPreviewSession } = require('./preview-session-ddb');
const { buildPublicMediaUrlForKey, encodeS3PathSegments } = require('../utils/media-url');
const { sha256Hex } = require('../utils/crypto');

const PREVIEW_TTL_SECONDS = 6 * 60 * 60;
const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_REMOTE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

let s3Client = null;
let s3Region = '';

function getS3Client(region) {
  if (s3Client && s3Region === region) return s3Client;
  s3Client = new S3Client({ region });
  s3Region = region;
  return s3Client;
}

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function getPublicSiteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.PORTFOLIO_PREVIEW_URL || 'https://www.grayson-wills.com')
    .trim()
    .replace(/\/+$/, '');
}

function toPreviewUrl(token, route = '/') {
  const base = getPublicSiteUrl();
  const normalizedRoute = String(route || '/').startsWith('/') ? String(route || '/') : `/${route}`;
  const url = new URL(`${base}${normalizedRoute}`);
  url.searchParams.set('previewToken', token);
  return url.toString();
}

function ownerUser(client) {
  return { sub: String(client?.ownerSub || '').trim() };
}

function toolResult(data, text = '') {
  return {
    content: [{
      type: 'text',
      text: text || JSON.stringify(data, null, 2),
    }],
    structuredContent: data,
  };
}

function summarizePatch(patch = {}) {
  const keys = Object.keys(patch || {}).filter((key) => !['contentHtml', 'contentMarkdown', 'roughDraftHtml'].includes(key));
  const contentBits = [];
  if (patch.contentHtml !== undefined) contentBits.push('contentHtml');
  if (patch.contentMarkdown !== undefined) contentBits.push('contentMarkdown');
  if (patch.roughDraftHtml !== undefined) contentBits.push('roughDraftHtml');
  return [...keys, ...contentBits].join(', ') || 'changes';
}

function withIdempotencyInput(inputSchema = {}) {
  return {
    ...(inputSchema || {}),
    idempotencyKey: z.string().optional(),
  };
}

function shouldUseIdempotency(config = {}, request = {}) {
  if (!config.category || config.category === 'read') return false;
  return Boolean(String(request?.idempotencyKey || '').trim());
}

async function createPreviewSession(payload, route = '/') {
  const token = crypto.randomBytes(18).toString('hex');
  await putPreviewSession(token, {
    ...(payload || {}),
    createdAt: new Date().toISOString(),
    source: payload?.source || 'mcp',
  }, PREVIEW_TTL_SECONDS);
  return {
    token,
    expiresInSeconds: PREVIEW_TTL_SECONDS,
    previewUrl: toPreviewUrl(token, route),
  };
}

function parseContentFilters(input = {}) {
  return {
    pageId: Number.isFinite(Number(input.pageId)) ? Number(input.pageId) : null,
    contentId: Number.isFinite(Number(input.contentId)) ? Number(input.contentId) : null,
    listItemID: String(input.listItemID || '').trim(),
    q: String(input.q || '').trim().toLowerCase(),
    offset: Math.max(0, Number(input.offset || 0) || 0),
    limit: Math.max(1, Math.min(100, Number(input.limit || 25) || 25)),
  };
}

async function listContent(input = {}) {
  const filters = parseContentFilters(input);
  let items = await ddbScanAllContent();
  items = (items || []).filter((item) => {
    if (filters.pageId !== null && Number(item.PageID) !== filters.pageId) return false;
    if (filters.contentId !== null && Number(item.PageContentID) !== filters.contentId) return false;
    if (filters.listItemID && String(item.ListItemID || '') !== filters.listItemID) return false;
    if (filters.q) {
      const blob = `${item.ID || ''} ${item.Text || ''} ${item.Photo || ''} ${JSON.stringify(item.Metadata || {})}`.toLowerCase();
      if (!blob.includes(filters.q)) return false;
    }
    return true;
  });
  items.sort((a, b) => String(b.UpdatedAt || b.CreatedAt || '').localeCompare(String(a.UpdatedAt || a.CreatedAt || '')));
  const pageItems = items.slice(filters.offset, filters.offset + filters.limit);
  return {
    items: pageItems,
    page: {
      offset: filters.offset,
      limit: filters.limit,
      returned: pageItems.length,
      total: items.length,
      hasMore: filters.offset + filters.limit < items.length,
      nextOffset: filters.offset + filters.limit < items.length ? filters.offset + filters.limit : null,
    },
  };
}

async function getContent(input = {}) {
  const id = String(input.id || '').trim();
  if (!id) throw httpError(400, 'id is required');
  const item = await ddbGetContentById(id);
  if (!item) throw httpError(404, 'Content record not found');
  return { item };
}

async function getInventory(client) {
  const [blog, categories, commentsRecent, socialStatus, deliveries] = await Promise.all([
    blogPosts.listPosts({ status: 'all', limit: 100 }).catch((err) => ({ error: err.message, items: [] })),
    blogPosts.listCategories({ includeArchived: true }).catch((err) => ({ error: err.message, categories: [] })),
    comments.listRecentComments({ limit: 50, includeDeleted: true }).catch((err) => ({ error: err.message, comments: [] })),
    socialAuth.getProviderStatus(ownerUser(client)).catch((err) => ({ error: err.message, providers: [] })),
    socialDistribution.listDeliveries(ownerUser(client), { limit: 100 }).catch((err) => ({ error: err.message, deliveries: [] })),
  ]);

  const posts = Array.isArray(blog.items) ? blog.items : [];
  const byStatus = posts.reduce((acc, post) => {
    const status = String(post.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const deliveryItems = Array.isArray(deliveries.deliveries) ? deliveries.deliveries : [];

  return {
    api: { ok: true, timestamp: new Date().toISOString() },
    blog: {
      total: posts.length,
      byStatus,
      categories: (categories.categories || []).map((category) => ({
        id: category.id,
        name: category.name,
        archived: Boolean(category.archived),
      })),
    },
    comments: {
      recentCount: Array.isArray(commentsRecent.comments) ? commentsRecent.comments.length : Array.isArray(commentsRecent) ? commentsRecent.length : 0,
    },
    social: {
      providers: (socialStatus.providers || socialStatus || []).map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        configured: Boolean(provider.configured),
        connected: Boolean(provider.connected),
        status: provider.status,
        accountLabel: provider.accountLabel || '',
      })),
      deliveries: {
        total: deliveryItems.length,
        byStatus: deliveryItems.reduce((acc, delivery) => {
          const status = String(delivery.status || 'unknown');
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {}),
      },
    },
    media: {
      enabled: isPhotoAssetsEnabled(),
    },
  };
}

function getPhotoAssetConfig() {
  const region = String(process.env.PHOTO_ASSETS_REGION || process.env.S3_UPLOAD_REGION || process.env.AWS_REGION || getAwsRegion()).trim();
  const bucket = String(process.env.PHOTO_ASSETS_BUCKET || process.env.S3_UPLOAD_BUCKET || '').trim();
  if (!bucket) throw httpError(503, 'PHOTO_ASSETS_BUCKET or S3_UPLOAD_BUCKET is not configured');
  if (!isPhotoAssetsEnabled()) throw httpError(503, 'PHOTO_ASSETS_TABLE_NAME is not configured');
  return {
    region,
    bucket,
    prefix: String(process.env.PHOTO_ASSETS_PREFIX || 'photo-assets/').replace(/^\/+/, '').replace(/\/?$/, '/'),
    cdnBaseUrl: String(process.env.PHOTO_ASSETS_CDN_BASE_URL || '').trim().replace(/\/+$/, ''),
  };
}

function safeFilenameFromUrl(url, contentType) {
  let base = 'remote-image';
  try {
    base = path.basename(new URL(url).pathname) || base;
  } catch {
    // keep fallback
  }
  const extFromType = contentType === 'image/png'
    ? '.png'
    : contentType === 'image/webp'
      ? '.webp'
      : contentType === 'image/gif'
        ? '.gif'
        : contentType === 'image/avif'
          ? '.avif'
          : '.jpg';
  const parsedExt = path.extname(base).toLowerCase();
  const safeBase = path.basename(base, parsedExt).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'remote-image';
  return `${safeBase}${parsedExt || extFromType}`;
}

function publicUrlForKey(cfg, key) {
  if (cfg.cdnBaseUrl) return `${cfg.cdnBaseUrl}/${encodeS3PathSegments(key)}`;
  return buildPublicMediaUrlForKey(null, key, {
    bucket: cfg.bucket,
    region: cfg.region,
    cdnBaseUrl: '',
  });
}

async function uploadImageFromUrl(input = {}, client) {
  const sourceUrl = String(input.url || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) throw httpError(400, 'A public http(s) image URL is required');
  const cfg = getPhotoAssetConfig();
  const response = await fetch(sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw httpError(400, `Remote image fetch failed: HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_REMOTE_IMAGE_TYPES.has(contentType)) throw httpError(400, `Unsupported remote image type: ${contentType || 'unknown'}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_REMOTE_IMAGE_BYTES) throw httpError(400, `Remote image is too large; max is ${MAX_REMOTE_IMAGE_BYTES} bytes`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REMOTE_IMAGE_BYTES) {
    throw httpError(400, `Remote image is too large; max is ${MAX_REMOTE_IMAGE_BYTES} bytes`);
  }

  const checksum = sha256Hex(bytes);
  const assetId = `asset-${uuidv4()}`;
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const filename = safeFilenameFromUrl(sourceUrl, contentType);
  const key = `${cfg.prefix}${yyyy}/${mm}/${dd}/${assetId}/${filename}`;
  const publicUrl = publicUrlForKey(cfg, key);
  const timestamp = now.toISOString();

  await createPendingPhotoAsset({
    asset_id: assetId,
    owner: String(client.ownerSub || 'mcp').toLowerCase(),
    status: 'pending',
    storage_bucket: cfg.bucket,
    storage_key: key,
    public_url: publicUrl,
    original_filename: filename,
    content_type: contentType,
    size_bytes: bytes.length,
    checksum_sha256: checksum,
    usage: String(input.usage || 'blog').slice(0, 40),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 20) : ['mcp'],
    alt_text: String(input.altText || '').slice(0, 240),
    caption: String(input.caption || '').slice(0, 1000),
    metadata: {
      source: 'mcp_remote_url',
      source_url_hash: sha256Hex(sourceUrl),
      clientId: client.clientId,
    },
    created_at: timestamp,
    updated_at: timestamp,
  });

  await getS3Client(cfg.region).send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public,max-age=31536000,immutable',
  }));

  const asset = await markPhotoAssetReady(assetId, {
    ready_at: new Date().toISOString(),
    public_url: publicUrl,
    content_type: contentType,
    size_bytes: bytes.length,
    checksum_sha256: checksum,
  });

  return { asset };
}

async function uploadImageFromBase64(input = {}, client) {
  const b64 = String(input.data || '').trim();
  if (!b64) throw httpError(400, 'Base64 image data is required');
  const contentType = String(input.contentType || 'image/png').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_REMOTE_IMAGE_TYPES.has(contentType)) {
    throw httpError(400, `Unsupported image type: ${contentType || 'unknown'}`);
  }
  let bytes;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch {
    throw httpError(400, 'Image data is not valid base64');
  }
  if (!bytes.length) throw httpError(400, 'Image data decoded to zero bytes');
  if (bytes.length > MAX_REMOTE_IMAGE_BYTES) {
    throw httpError(400, `Image is too large; max is ${MAX_REMOTE_IMAGE_BYTES} bytes`);
  }

  const cfg = getPhotoAssetConfig();
  const checksum = sha256Hex(bytes);
  const assetId = `asset-${uuidv4()}`;
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const ext = contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/gif' ? '.gif' : '.png';
  const filename = String(input.filename || `upload${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || `upload${ext}`;
  const key = `${cfg.prefix}${yyyy}/${mm}/${dd}/${assetId}/${filename}`;
  const publicUrl = publicUrlForKey(cfg, key);
  const timestamp = now.toISOString();

  await createPendingPhotoAsset({
    asset_id: assetId,
    owner: String(client.ownerSub || 'mcp').toLowerCase(),
    status: 'pending',
    storage_bucket: cfg.bucket,
    storage_key: key,
    public_url: publicUrl,
    original_filename: filename,
    content_type: contentType,
    size_bytes: bytes.length,
    checksum_sha256: checksum,
    usage: String(input.usage || 'social').slice(0, 40),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 20) : ['mcp'],
    alt_text: String(input.altText || '').slice(0, 240),
    caption: String(input.caption || '').slice(0, 1000),
    metadata: {
      source: 'mcp_base64',
      clientId: client.clientId,
    },
    created_at: timestamp,
    updated_at: timestamp,
  });

  await getS3Client(cfg.region).send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public,max-age=31536000,immutable',
  }));

  const asset = await markPhotoAssetReady(assetId, {
    ready_at: new Date().toISOString(),
    public_url: publicUrl,
    content_type: contentType,
    size_bytes: bytes.length,
    checksum_sha256: checksum,
  });

  return { asset };
}

async function executeApproval(approvalId, reviewerUser) {
  const approval = await mcpControl.getApproval(approvalId);
  if (!approval) throw httpError(404, 'Approval not found');
  if (approval.status !== 'pending') throw httpError(409, 'Approval is no longer pending');
  if (Number(approval.expiresAtEpoch || 0) && Number(approval.expiresAtEpoch) <= Math.floor(Date.now() / 1000)) {
    throw httpError(410, 'Approval has expired');
  }

  await mcpControl.decideApproval({ approvalId, decision: 'approved', reviewerUser });
  const payload = approval.payload || {};
  let result;

  try {
    if (approval.action === 'blog.propose_update') {
      result = await blogPosts.updatePost(payload.listItemID, payload.patch || {}, {
        actor: { sub: mcpControl.userSubFrom(reviewerUser) },
        source: 'approval',
      });
    } else if (approval.action === 'blog.request_publish') {
      const listItemID = String(payload.listItemID || '').trim();
      await blogPosts.updatePost(listItemID, {
        status: 'published',
        publishDate: new Date().toISOString(),
      }, {
        actor: { sub: mcpControl.userSubFrom(reviewerUser) },
        source: 'approval',
      });
      result = await notifications.sendPublishedBlogPostEvents({
        listItemID,
        topic: payload.topic || 'blog_posts',
        force: payload.force === true,
        sendEmail: payload.sendEmail !== false,
        userSub: approval.ownerSub,
      });
    } else if (approval.action === 'blog.request_schedule') {
      result = await notifications.schedulePublish({
        listItemID: payload.listItemID,
        publishAt: payload.publishAt,
        sendEmail: payload.sendEmail !== false,
        topic: payload.topic || 'blog_posts',
        userSub: approval.ownerSub,
      });
    } else if (approval.action === 'blog.request_unpublish') {
      result = await notifications.unpublishBlogPost({ listItemID: payload.listItemID });
    } else if (approval.action === 'blog.request_delete') {
      result = await blogPosts.deletePost(payload.listItemID);
    } else if (approval.action === 'content.propose_update') {
      const item = await ddbGetContentById(payload.id);
      if (!item) throw httpError(404, 'Content record not found');
      result = await ddbPutContent({
        ...item,
        ...(payload.patch || {}),
        ID: item.ID,
        UpdatedAt: new Date().toISOString(),
      });
    } else if (approval.action === 'media.request_delete') {
      const asset = await getPhotoAssetById(payload.assetId);
      if (!asset) throw httpError(404, 'Photo asset not found');
      const updated = await markPhotoAssetDeleted(payload.assetId, { hard_deleted: Boolean(payload.hardDelete) });
      if (payload.purgeMetadata) await deletePhotoAssetRecord(payload.assetId);
      result = { ok: true, asset: payload.purgeMetadata ? null : updated };
    } else if (approval.action === 'comments.propose_reply') {
      result = await comments.createAdminReply({
        commentId: payload.commentId,
        body: payload.body,
        decodedUser: reviewerUser,
      });
    } else if (approval.action === 'comments.request_delete') {
      result = await comments.softDeleteComment({
        commentId: payload.commentId,
        decodedUser: reviewerUser,
        admin: true,
      });
    } else if (approval.action === 'social.propose_settings_update') {
      result = await socialDistribution.saveSettings(ownerUser({ ownerSub: approval.ownerSub }), payload.settings || {});
    } else if (approval.action === 'social.request_send_delivery') {
      result = await socialDistribution.sendDeliveryById({
        userSub: approval.ownerSub,
        deliveryId: payload.deliveryId,
        force: true,
      });
    } else {
      throw httpError(400, `Unsupported approval action: ${approval.action}`);
    }

    const executed = await mcpControl.decideApproval({
      approvalId,
      decision: 'executed',
      reviewerUser,
      result,
    });
    await mcpControl.auditToolCall({
      client: { clientId: approval.clientId, name: approval.clientName, ownerSub: approval.ownerSub },
      toolName: `approval.execute.${approval.action}`,
      targetIds: approval.targetIds,
      request: payload,
      status: 'executed',
      approvalId,
    });
    return { approval: executed, result };
  } catch (err) {
    await mcpControl.decideApproval({
      approvalId,
      decision: 'failed',
      reviewerUser,
      error: err?.message || 'Approval execution failed',
    });
    throw err;
  }
}

function registerTool(server, client, name, config, handler) {
  const inputSchema = config.category && config.category !== 'read'
    ? withIdempotencyInput(config.inputSchema || {})
    : config.inputSchema || {};

  server.registerTool(name, {
    title: config.title || name,
    description: config.description,
    inputSchema,
  }, async (args) => {
    const request = args || {};
    const idempotencyKey = String(request.idempotencyKey || '').trim();
    const idempotencyScope = `mcp:${client.clientId}:${name}`;
    try {
      mcpControl.requireScope(client, config.scope);
      if (shouldUseIdempotency(config, request)) {
        const replay = await mcpControl.getIdempotentResult({
          scope: idempotencyScope,
          key: idempotencyKey,
          request,
        });
        if (replay) {
          await mcpControl.auditToolCall({
            client,
            toolName: name,
            targetIds: config.targetIds ? config.targetIds(request, replay.response) : [],
            request,
            status: 'idempotent_replay',
            approvalId: replay.response?.approvalId || replay.response?.approval?.approvalId || '',
          });
          return toolResult(replay.response);
        }
      }
      await mcpControl.consumeRateLimit(client, config.category || 'read');
      const data = await handler(request);
      if (shouldUseIdempotency(config, request)) {
        await mcpControl.storeIdempotentResult({
          scope: idempotencyScope,
          key: idempotencyKey,
          request,
          response: data,
          statusCode: 200,
        });
      }
      await mcpControl.auditToolCall({
        client,
        toolName: name,
        targetIds: config.targetIds ? config.targetIds(request, data) : [],
        request,
        status: 'ok',
        approvalId: data?.approvalId || data?.approval?.approvalId || '',
      });
      return toolResult(data);
    } catch (err) {
      await mcpControl.auditToolCall({
        client,
        toolName: name,
        targetIds: [],
        request,
        status: 'failed',
        error: err?.message || String(err),
      });
      throw err;
    }
  });
}

function createApprovalTool(server, client, name, scope, inputSchema, buildApproval) {
  registerTool(server, client, name, {
    description: `Request human approval for ${name}.`,
    scope,
    category: 'approvalMutation',
    inputSchema: withIdempotencyInput(inputSchema),
  }, async (args) => {
    const approval = await buildApproval(args || {});
    if (mcpControl.canAutoExecute(client, name)) {
      const executed = await executeApproval(approval.approvalId, ownerUser(client));
      return {
        approvalId: executed.approval.approvalId,
        summary: executed.approval.summary,
        targetIds: executed.approval.targetIds,
        previewUrl: executed.approval.previewUrl,
        autoExecuted: true,
        approval: executed.approval,
        result: executed.result,
      };
    }
    return {
      approvalId: approval.approvalId,
      summary: approval.summary,
      targetIds: approval.targetIds,
      previewUrl: approval.previewUrl,
      autoExecuted: false,
      approval,
    };
  });
}

function buildMcpServer(client) {
  const server = new McpServer({
    name: 'portfolio-blog-authoring',
    version: '1.0.0',
  });

  registerTool(server, client, 'site.get_inventory', {
    description: 'Summarize public site and authoring inventory without secrets.',
    scope: 'site:read',
    inputSchema: {},
  }, async () => getInventory(client));

  registerTool(server, client, 'content.list', {
    description: 'List content records by page/content/list item filters.',
    scope: 'content:read',
    inputSchema: {
      pageId: z.number().optional(),
      contentId: z.number().optional(),
      listItemID: z.string().optional(),
      q: z.string().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  }, listContent);

  registerTool(server, client, 'content.get', {
    description: 'Fetch one content record by ID.',
    scope: 'content:read',
    inputSchema: { id: z.string() },
    targetIds: (args) => [args.id],
  }, getContent);

  registerTool(server, client, 'blog.list_posts', {
    description: 'List canonical blog posts.',
    scope: 'blog:read',
    inputSchema: {
      status: z.string().optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      q: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  }, blogPosts.listPosts);

  registerTool(server, client, 'blog.get_post', {
    description: 'Fetch a full canonical blog post bundle.',
    scope: 'blog:read',
    inputSchema: { listItemID: z.string() },
    targetIds: (args) => [args.listItemID],
  }, async (args) => ({ post: await blogPosts.getPost(args.listItemID) }));

  registerTool(server, client, 'media.list_assets', {
    description: 'List photo assets.',
    scope: 'media:read',
    inputSchema: {
      limit: z.number().optional(),
      nextToken: z.string().optional(),
      status: z.string().optional(),
      usage: z.string().optional(),
    },
  }, async (args) => listPhotoAssets({
    limit: args.limit || 24,
    nextToken: args.nextToken || '',
    status: args.status || '',
    usage: args.usage || '',
    owner: String(client.ownerSub || '').toLowerCase(),
  }));

  registerTool(server, client, 'comments.list_recent', {
    description: 'List recent comments with moderation body visibility.',
    scope: 'comments:read',
    inputSchema: {
      limit: z.number().optional(),
      postId: z.string().optional(),
      includeDeleted: z.boolean().optional(),
    },
  }, async (args) => ({
    comments: await comments.listRecentComments({
      limit: args.limit || 100,
      postId: args.postId || '',
      includeDeleted: args.includeDeleted === true,
    }),
  }));

  registerTool(server, client, 'comments.get_thread', {
    description: 'Fetch a full comment thread for one blog post.',
    scope: 'comments:read',
    inputSchema: { postId: z.string() },
    targetIds: (args) => [args.postId],
  }, async (args) => ({
    comments: await comments.listCommentsByPost(args.postId, { viewerSub: client.ownerSub || '' }),
  }));

  registerTool(server, client, 'social.get_status', {
    description: 'Read social provider connection status and selected posting identities.',
    scope: 'social:read',
    inputSchema: {},
  }, async () => ({ providers: await socialAuth.getProviderStatus(ownerUser(client)) }));

  registerTool(server, client, 'social.list_deliveries', {
    description: 'List social delivery queue records.',
    scope: 'social:read',
    inputSchema: { limit: z.number().optional() },
  }, async (args) => socialDistribution.listDeliveries(ownerUser(client), { limit: args.limit || 100 }));

  registerTool(server, client, 'blog.create_draft', {
    description: 'Create a draft blog post only.',
    scope: 'blog:write:draft',
    category: 'draftMutation',
    inputSchema: {
      listItemID: z.string().optional(),
      title: z.string(),
      summary: z.string().optional(),
      contentHtml: z.string().optional(),
      contentMarkdown: z.string().optional(),
      roughDraftHtml: z.string().optional(),
      tags: z.array(z.string()).optional(),
      privateSeoTags: z.array(z.string()).optional(),
      category: z.string().optional(),
      readTimeMinutes: z.number().optional(),
      coverImageUrl: z.string().optional(),
      signatureId: z.string().optional(),
    },
    targetIds: (_args, data) => [data?.post?.listItemID].filter(Boolean),
  }, async (args) => ({
    post: await blogPosts.createPost(args, {
      actor: { clientId: client.clientId, clientName: client.name, sub: client.ownerSub },
      source: 'mcp',
      draftOnly: true,
    }),
  }));

  registerTool(server, client, 'blog.update_mcp_draft', {
    description: 'Update a draft created by the same MCP client.',
    scope: 'blog:write:draft',
    category: 'draftMutation',
    inputSchema: {
      listItemID: z.string(),
      title: z.string().optional(),
      summary: z.string().optional(),
      contentHtml: z.string().optional(),
      contentMarkdown: z.string().optional(),
      roughDraftHtml: z.string().optional(),
      tags: z.array(z.string()).optional(),
      privateSeoTags: z.array(z.string()).optional(),
      category: z.string().optional(),
      readTimeMinutes: z.number().optional(),
      coverImageUrl: z.string().optional(),
      expectedUpdatedAt: z.string().optional(),
      expectedVersion: z.number().optional(),
    },
    targetIds: (args) => [args.listItemID],
  }, async (args) => ({
    post: await blogPosts.updatePost(args.listItemID, args, {
      actor: { clientId: client.clientId, clientName: client.name, sub: client.ownerSub },
      source: 'mcp',
      restrictMcpDraftOwner: true,
    }),
  }));

  registerTool(server, client, 'blog.delete_mcp_draft', {
    description: 'Delete a draft created by the same MCP client.',
    scope: 'blog:write:draft',
    category: 'draftMutation',
    inputSchema: {
      listItemID: z.string(),
      expectedUpdatedAt: z.string().optional(),
      expectedVersion: z.number().optional(),
    },
    targetIds: (args) => [args.listItemID],
  }, async (args) => blogPosts.deletePost(args.listItemID, {
    actor: { clientId: client.clientId, clientName: client.name, sub: client.ownerSub },
    restrictMcpDraftOwner: true,
    expectedUpdatedAt: args.expectedUpdatedAt || '',
    expectedVersion: args.expectedVersion,
  }));

  registerTool(server, client, 'preview.create', {
    description: 'Create a preview session for content upserts/deletes.',
    scope: 'content:write:draft',
    category: 'draftMutation',
    inputSchema: {
      upserts: z.array(z.any()).optional(),
      deleteIds: z.array(z.string()).optional(),
      deleteListItemIds: z.array(z.string()).optional(),
      forceVisibleListItemIds: z.array(z.string()).optional(),
      route: z.string().optional(),
    },
  }, async (args) => createPreviewSession({
    upserts: Array.isArray(args.upserts) ? args.upserts.slice(0, 100) : [],
    deleteIds: Array.isArray(args.deleteIds) ? args.deleteIds.slice(0, 100) : [],
    deleteListItemIds: Array.isArray(args.deleteListItemIds) ? args.deleteListItemIds.slice(0, 100) : [],
    forceVisibleListItemIds: Array.isArray(args.forceVisibleListItemIds) ? args.forceVisibleListItemIds.slice(0, 100) : [],
    source: 'mcp',
  }, args.route || '/'));

  registerTool(server, client, 'media.upload_image_from_url', {
    description: 'Download a remote public image URL and store it as a photo asset.',
    scope: 'media:write:draft',
    category: 'draftMutation',
    inputSchema: {
      url: z.string(),
      usage: z.string().optional(),
      tags: z.array(z.string()).optional(),
      altText: z.string().optional(),
      caption: z.string().optional(),
    },
  }, async (args) => uploadImageFromUrl(args, client));

  registerTool(server, client, 'social.create_delivery_draft', {
    description: 'Create a social delivery draft. This never sends externally.',
    scope: 'social:write:draft',
    category: 'draftMutation',
    inputSchema: {
      provider: z.string(),
      caption: z.string(),
      listItemID: z.string().optional(),
      destination: z.string().optional(),
      mediaUrl: z.string().optional(),
      postUrl: z.string().optional(),
      title: z.string().optional(),
      runAt: z.string().optional(),
      quietMode: z.boolean().optional(),
    },
  }, async (args) => ({
    delivery: await socialDistribution.createDeliveryDraftForUser(ownerUser(client), args),
  }));

  registerTool(server, client, 'media.upload_image_base64', {
    description: 'Store a base64-encoded image as a photo asset (for callers whose storage is not publicly fetchable).',
    scope: 'media:write:draft',
    category: 'draftMutation',
    inputSchema: {
      data: z.string(),
      contentType: z.string().optional(),
      filename: z.string().optional(),
      usage: z.string().optional(),
      tags: z.array(z.string()).optional(),
      altText: z.string().optional(),
      caption: z.string().optional(),
    },
  }, async (args) => uploadImageFromBase64(args, client));

  registerTool(server, client, 'social.schedule_delivery', {
    description: 'Create AND immediately send a social delivery through the connected account, bypassing the studio review queue. Grant social:write:send only to automation that already gates posts upstream (e.g. the mesh, which reviews everything in Mission Control before calling this).',
    scope: 'social:write:send',
    category: 'externalMutation',
    inputSchema: {
      provider: z.string(),
      caption: z.string(),
      mediaUrl: z.string().optional(),
      imageBase64: z.string().optional(),
      imageContentType: z.string().optional(),
      destination: z.string().optional(),
      postUrl: z.string().optional(),
      title: z.string().optional(),
    },
  }, async (args) => {
    let mediaUrl = String(args.mediaUrl || '').trim();
    if (!mediaUrl && args.imageBase64) {
      const stored = await uploadImageFromBase64({
        data: args.imageBase64,
        contentType: args.imageContentType,
        usage: 'social',
        caption: String(args.caption || '').slice(0, 200),
      }, client);
      mediaUrl = String(stored.asset?.public_url || '').trim();
    }
    const draft = await socialDistribution.createDeliveryDraftForUser(ownerUser(client), {
      provider: args.provider,
      caption: args.caption,
      mediaUrl,
      destination: args.destination,
      postUrl: args.postUrl,
      title: args.title || 'Mesh social post',
      listItemID: 'mesh-social',
      ruleId: 'mesh-single-gate',
      ruleName: 'Mesh pre-gated delivery',
    });
    if (draft.lastError) {
      throw httpError(409, `Provider is not ready: ${draft.lastError}`);
    }
    const delivery = await socialDistribution.sendDeliveryById({
      userSub: ownerUser(client).sub,
      deliveryId: draft.deliveryId,
      force: true,
    });
    return { delivery };
  });

  createApprovalTool(server, client, 'blog.propose_update', 'blog:propose', {
    listItemID: z.string(),
    patch: z.object({}).passthrough(),
  }, async (args) => {
    const current = await blogPosts.getPost(args.listItemID, { includeItems: true });
    const proposed = await blogPosts.previewUpdatedPost(args.listItemID, args.patch || {}, {
      actor: { clientId: client.clientId, clientName: client.name, sub: client.ownerSub },
      source: 'authoring',
    });
    const preview = await createPreviewSession({
      upserts: proposed.items || current.items || [],
      source: 'mcp-propose-update',
    }, `/blog/${encodeURIComponent(args.listItemID)}`);
    return mcpControl.createApproval({
      client,
      action: 'blog.propose_update',
      payload: args,
      summary: `Update blog post "${current.title}" (${summarizePatch(args.patch)})`,
      targetIds: [args.listItemID],
      previewUrl: preview.previewUrl,
      diff: { patch: args.patch },
    });
  });

  createApprovalTool(server, client, 'blog.request_publish', 'blog:propose', {
    listItemID: z.string(),
    sendEmail: z.boolean().optional(),
    topic: z.string().optional(),
    force: z.boolean().optional(),
  }, async (args) => {
    const post = await blogPosts.getPost(args.listItemID, { includeItems: false });
    return mcpControl.createApproval({
      client,
      action: 'blog.request_publish',
      payload: args,
      summary: `Publish "${post.title}" now${args.sendEmail === false ? ' without email' : ' and run publish automations'}`,
      targetIds: [args.listItemID],
      previewUrl: `${getPublicSiteUrl()}/blog/${encodeURIComponent(args.listItemID)}`,
    });
  });

  createApprovalTool(server, client, 'blog.request_schedule', 'blog:propose', {
    listItemID: z.string(),
    publishAt: z.string(),
    sendEmail: z.boolean().optional(),
    topic: z.string().optional(),
  }, async (args) => {
    const post = await blogPosts.getPost(args.listItemID, { includeItems: false });
    return mcpControl.createApproval({
      client,
      action: 'blog.request_schedule',
      payload: args,
      summary: `Schedule "${post.title}" for ${args.publishAt}`,
      targetIds: [args.listItemID],
      previewUrl: `${getPublicSiteUrl()}/blog/${encodeURIComponent(args.listItemID)}`,
    });
  });

  createApprovalTool(server, client, 'blog.request_unpublish', 'blog:propose', {
    listItemID: z.string(),
  }, async (args) => {
    const post = await blogPosts.getPost(args.listItemID, { includeItems: false });
    return mcpControl.createApproval({
      client,
      action: 'blog.request_unpublish',
      payload: args,
      summary: `Unpublish "${post.title}"`,
      targetIds: [args.listItemID],
    });
  });

  createApprovalTool(server, client, 'blog.request_delete', 'blog:propose', {
    listItemID: z.string(),
  }, async (args) => {
    const post = await blogPosts.getPost(args.listItemID, { includeItems: false });
    return mcpControl.createApproval({
      client,
      action: 'blog.request_delete',
      payload: args,
      summary: `Delete blog post "${post.title}"`,
      targetIds: [args.listItemID],
    });
  });

  createApprovalTool(server, client, 'content.propose_update', 'content:write:draft', {
    id: z.string(),
    patch: z.object({}).passthrough(),
    route: z.string().optional(),
  }, async (args) => {
    const item = await ddbGetContentById(args.id);
    if (!item) throw httpError(404, 'Content record not found');
    const route = String(args.route || '').trim();
    const preview = route
      ? await createPreviewSession({
        upserts: [{ ...item, ...(args.patch || {}), ID: item.ID, UpdatedAt: new Date().toISOString() }],
        source: 'mcp-content-propose-update',
      }, route)
      : null;
    return mcpControl.createApproval({
      client,
      action: 'content.propose_update',
      payload: args,
      summary: `Update content record ${args.id}`,
      targetIds: [args.id],
      previewUrl: preview?.previewUrl || '',
      diff: { before: item, patch: args.patch },
    });
  });

  createApprovalTool(server, client, 'media.request_delete', 'media:write:draft', {
    assetId: z.string(),
    hardDelete: z.boolean().optional(),
    purgeMetadata: z.boolean().optional(),
  }, async (args) => {
    const asset = await getPhotoAssetById(args.assetId);
    if (!asset) throw httpError(404, 'Photo asset not found');
    return mcpControl.createApproval({
      client,
      action: 'media.request_delete',
      payload: args,
      summary: `Delete media asset ${args.assetId}`,
      targetIds: [args.assetId],
    });
  });

  createApprovalTool(server, client, 'comments.propose_reply', 'comments:propose', {
    commentId: z.string(),
    body: z.string(),
  }, async (args) => mcpControl.createApproval({
    client,
    action: 'comments.propose_reply',
    payload: args,
    summary: `Reply to comment ${args.commentId}`,
    targetIds: [args.commentId],
  }));

  createApprovalTool(server, client, 'comments.request_delete', 'comments:propose', {
    commentId: z.string(),
  }, async (args) => mcpControl.createApproval({
    client,
    action: 'comments.request_delete',
    payload: args,
    summary: `Delete comment ${args.commentId}`,
    targetIds: [args.commentId],
  }));

  createApprovalTool(server, client, 'social.propose_settings_update', 'social:propose', {
    settings: z.object({}).passthrough(),
  }, async (args) => mcpControl.createApproval({
    client,
    action: 'social.propose_settings_update',
    payload: args,
    summary: 'Update social distribution settings',
    targetIds: ['social-distribution-settings'],
    diff: { settings: args.settings },
  }));

  createApprovalTool(server, client, 'social.request_send_delivery', 'social:propose', {
    deliveryId: z.string(),
  }, async (args) => mcpControl.createApproval({
    client,
    action: 'social.request_send_delivery',
    payload: args,
    summary: `Send social delivery ${args.deliveryId}`,
    targetIds: [args.deliveryId],
  }));

  return server;
}

module.exports = {
  buildMcpServer,
  executeApproval,
};
