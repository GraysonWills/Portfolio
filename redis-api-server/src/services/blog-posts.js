const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { z } = require('zod');

const {
  ddbBatchPutContent,
  ddbDeleteContentById,
  ddbDeleteContentByListItemId,
  ddbGetContentById,
  ddbGetContentByListItemId,
  ddbPutContent,
  ddbScanAllContent,
  isContentDdbEnabled,
} = require('./content-ddb');
const { normalizeMetadata } = require('./content-read-model');

const BLOG_PAGE_ID = 3;
const BLOG_ITEM_CONTENT_ID = 3;
const BLOG_TEXT_CONTENT_ID = 4;
const BLOG_IMAGE_CONTENT_ID = 5;
const BLOG_BODY_CONTENT_ID = 13;
const BLOG_ROUGH_DRAFT_CONTENT_ID = 18;
const BLOG_CATEGORY_REGISTRY_CONTENT_ID = 16;

const CATEGORY_REGISTRY_ID = 'blog-category-registry-record';
const CATEGORY_REGISTRY_LIST_ITEM_ID = 'blog-category-registry';
const MAX_CONTENT_CHARS = 250_000;
const VALID_STATUSES = new Set(['draft', 'scheduled', 'published']);
const BLOG_RECORD_CONTENT_IDS = [
  BLOG_ITEM_CONTENT_ID,
  BLOG_TEXT_CONTENT_ID,
  BLOG_BODY_CONTENT_ID,
  BLOG_IMAGE_CONTENT_ID,
  BLOG_ROUGH_DRAFT_CONTENT_ID,
];

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function requireContentStore() {
  if (!isContentDdbEnabled()) {
    throw httpError(503, 'CONTENT_TABLE_NAME is not configured for canonical blog APIs');
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, max = 1000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeStringList(value, maxItems = 40, maxChars = 80) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (out.length >= maxItems) break;
    const item = normalizeString(raw, maxChars);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeDateIso(value, fallback = new Date()) {
  if (!value) return new Date(fallback).toISOString();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'publishDate must be a valid date');
  return d.toISOString();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, Math.max(1, heading[1].length));
      blocks.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(escapeHtml(bullet[1]));
      continue;
    }

    if (line.startsWith('>')) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${escapeHtml(line.replace(/^>+\s*/, ''))}</blockquote>`);
      continue;
    }

    paragraph.push(escapeHtml(line));
  }

  flushParagraph();
  flushList();
  return blocks.join('\n');
}

function sanitizeBlogHtml(value) {
  const raw = String(value || '').slice(0, MAX_CONTENT_CHARS);
  return sanitizeHtml(raw, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'h1',
      'h2',
      'h3',
      'h4',
      'img',
      'figure',
      'figcaption',
      'span',
      'div',
      'pre',
      'code',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class'],
      p: ['class'],
      div: ['class', 'data-post-carousel'],
      span: ['class'],
      blockquote: ['class'],
      code: ['class'],
      pre: ['class'],
      figure: ['class'],
      figcaption: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading || 'lazy',
        },
      }),
    },
  }).trim();
}

function contentHtmlFromInput(input) {
  const html = normalizeString(input?.contentHtml, MAX_CONTENT_CHARS);
  if (html) return sanitizeBlogHtml(html);
  const markdown = normalizeString(input?.contentMarkdown, MAX_CONTENT_CHARS);
  if (markdown) return sanitizeBlogHtml(markdownToHtml(markdown));
  return '';
}

const postInputSchema = z.object({
  listItemID: z.string().trim().max(180).optional(),
  title: z.string().trim().min(1).max(220),
  summary: z.string().trim().max(1200).optional().default(''),
  contentHtml: z.string().max(MAX_CONTENT_CHARS).optional(),
  contentMarkdown: z.string().max(MAX_CONTENT_CHARS).optional(),
  roughDraftHtml: z.string().max(MAX_CONTENT_CHARS).optional(),
  tags: z.array(z.string()).max(60).optional().default([]),
  privateSeoTags: z.array(z.string()).max(80).optional().default([]),
  category: z.string().trim().max(120).optional().default('General'),
  readTimeMinutes: z.coerce.number().min(1).max(120).optional(),
  coverImageUrl: z.string().trim().max(2000).optional().default(''),
  imageUrl: z.string().trim().max(2000).optional().default(''),
  publishDate: z.union([z.string(), z.date()]).optional(),
  status: z.enum(['draft', 'scheduled', 'published']).optional().default('draft'),
  signatureId: z.string().trim().max(120).optional().default(''),
  signatureSnapshot: z.object({}).passthrough().optional(),
});

const postPatchSchema = postInputSchema.partial().extend({
  expectedUpdatedAt: z.string().trim().optional(),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

function validateCreateInput(input, { draftOnly = false } = {}) {
  const parsed = postInputSchema.safeParse(input || {});
  if (!parsed.success) throw httpError(400, 'Invalid blog post payload', parsed.error.flatten());
  const value = parsed.data;
  const contentHtml = contentHtmlFromInput(value);
  if (!contentHtml) throw httpError(400, 'contentHtml or contentMarkdown is required');
  if (draftOnly) value.status = 'draft';
  return {
    ...value,
    title: normalizeString(value.title, 220),
    summary: normalizeString(value.summary, 1200),
    contentHtml,
    roughDraftHtml: sanitizeBlogHtml(value.roughDraftHtml || ''),
    tags: normalizeStringList(value.tags),
    privateSeoTags: normalizeStringList(value.privateSeoTags, 80),
    category: normalizeString(value.category || 'General', 120) || 'General',
    coverImageUrl: normalizeString(value.coverImageUrl || value.imageUrl || '', 2000),
  };
}

function validatePatchInput(input) {
  const parsed = postPatchSchema.safeParse(input || {});
  if (!parsed.success) throw httpError(400, 'Invalid blog post patch', parsed.error.flatten());
  const value = parsed.data;
  const out = { ...value };
  if (value.title !== undefined) out.title = normalizeString(value.title, 220);
  if (value.summary !== undefined) out.summary = normalizeString(value.summary, 1200);
  if (value.contentHtml !== undefined || value.contentMarkdown !== undefined) {
    out.contentHtml = contentHtmlFromInput(value);
    if (!out.contentHtml) throw httpError(400, 'contentHtml or contentMarkdown cannot be empty');
  }
  if (value.roughDraftHtml !== undefined) out.roughDraftHtml = sanitizeBlogHtml(value.roughDraftHtml || '');
  if (value.tags !== undefined) out.tags = normalizeStringList(value.tags);
  if (value.privateSeoTags !== undefined) out.privateSeoTags = normalizeStringList(value.privateSeoTags, 80);
  if (value.category !== undefined) out.category = normalizeString(value.category || 'General', 120) || 'General';
  if (value.coverImageUrl !== undefined || value.imageUrl !== undefined) {
    out.coverImageUrl = normalizeString(value.coverImageUrl || value.imageUrl || '', 2000);
  }
  return out;
}

function computeReadTimeMinutes(contentHtml) {
  const text = sanitizeHtml(String(contentHtml || ''), { allowedTags: [], allowedAttributes: {} });
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function normalizeRecordItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    ...item,
    PageID: Number(item.PageID),
    PageContentID: Number(item.PageContentID),
    Metadata: normalizeMetadata(item.Metadata),
  };
}

function getItemByContentId(items, contentId) {
  return (items || []).find((item) => Number(item?.PageContentID) === Number(contentId)) || null;
}

function deterministicRecordIdsForListItem(listItemID) {
  return [
    `blog-item-${listItemID}`,
    `blog-text-${listItemID}`,
    `blog-body-${listItemID}`,
    `blog-image-${listItemID}`,
    `blog-rough-${listItemID}`,
  ];
}

async function getBlogRecordsByListItemId(listItemID) {
  const items = await ddbGetContentByListItemId(listItemID);
  if (items && items.length) return items;

  const deterministic = await Promise.all(
    deterministicRecordIdsForListItem(listItemID).map((id) => ddbGetContentById(id).catch(() => null))
  );
  return deterministic
    .filter(Boolean)
    .filter((item) => String(item?.ListItemID || '') === String(listItemID))
    .filter((item) => BLOG_RECORD_CONTENT_IDS.includes(Number(item?.PageContentID)));
}

function maxUpdatedAt(items) {
  const dates = (items || [])
    .map((item) => item?.UpdatedAt || item?.CreatedAt)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

function statusFromMetadata(metadata = {}) {
  const status = String(metadata.status || 'published').trim().toLowerCase() || 'published';
  if (status !== 'published') return VALID_STATUSES.has(status) ? status : 'draft';
  const ts = metadata.publishDate ? new Date(metadata.publishDate).getTime() : 0;
  if (Number.isFinite(ts) && ts > Date.now()) return 'scheduled';
  return 'published';
}

function recordsToPost(items, { includeItems = false } = {}) {
  const normalized = (items || []).map(normalizeRecordItem).filter(Boolean);
  const blogItem = getItemByContentId(normalized, BLOG_ITEM_CONTENT_ID);
  if (!blogItem) return null;

  const metadata = normalizeMetadata(blogItem.Metadata);
  const listItemID = String(blogItem.ListItemID || '').trim();
  if (!listItemID) return null;

  const textItem = getItemByContentId(normalized, BLOG_TEXT_CONTENT_ID);
  const bodyItem = getItemByContentId(normalized, BLOG_BODY_CONTENT_ID);
  const roughItem = getItemByContentId(normalized, BLOG_ROUGH_DRAFT_CONTENT_ID);
  const imageItem = getItemByContentId(normalized, BLOG_IMAGE_CONTENT_ID);
  const contentHtml = String(bodyItem?.Text || textItem?.Text || '');
  const title = String(metadata.title || blogItem.Text || textItem?.Text || 'Untitled').trim() || 'Untitled';
  const updatedAt = maxUpdatedAt(normalized);

  return {
    listItemID,
    title,
    summary: String(metadata.summary || textItem?.Text || '').slice(0, 1200),
    contentHtml,
    roughDraftHtml: String(roughItem?.Text || ''),
    coverImageUrl: String(imageItem?.Photo || metadata.coverImageUrl || metadata.imageUrl || '').trim(),
    status: statusFromMetadata(metadata),
    tags: normalizeStringList(metadata.tags || []),
    privateSeoTags: normalizeStringList(metadata.privateSeoTags || [], 80),
    category: String(metadata.category || 'General').trim() || 'General',
    readTimeMinutes: Math.max(1, Math.round(Number(metadata.readTimeMinutes || computeReadTimeMinutes(contentHtml)))),
    publishDate: metadata.publishDate ? new Date(metadata.publishDate).toISOString() : null,
    scheduleName: metadata.scheduleName || null,
    scheduledAt: metadata.scheduledAt || null,
    metadata,
    version: Number.isFinite(Number(metadata.version)) ? Number(metadata.version) : 0,
    updatedAt,
    createdAt: blogItem.CreatedAt || null,
    source: metadata.mcpSource || metadata.source || null,
    recordIds: {
      blogItemId: blogItem.ID || null,
      blogTextId: textItem?.ID || null,
      blogBodyId: bodyItem?.ID || null,
      blogRoughDraftId: roughItem?.ID || null,
      blogImageId: imageItem?.ID || null,
    },
    ...(includeItems ? { items: normalized } : {}),
  };
}

function generateListItemID(title) {
  const slug = normalizeSlug(title) || 'blog';
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${slug}-${Date.now().toString(36)}-${suffix}`.slice(0, 180);
}

function buildRecordsFromInput(input, { existingItems = [], actor = {}, source = 'authoring' } = {}) {
  const existing = (existingItems || []).map(normalizeRecordItem).filter(Boolean);
  const existingPost = existing.length ? recordsToPost(existing, { includeItems: true }) : null;
  const timestamp = nowIso();
  const listItemID = normalizeString(input.listItemID || existingPost?.listItemID || generateListItemID(input.title), 180);
  const previousMeta = normalizeMetadata(getItemByContentId(existing, BLOG_ITEM_CONTENT_ID)?.Metadata);
  const publishDate = input.publishDate !== undefined
    ? normalizeDateIso(input.publishDate)
    : previousMeta.publishDate
      ? normalizeDateIso(previousMeta.publishDate)
      : timestamp;
  const contentHtml = input.contentHtml !== undefined ? input.contentHtml : existingPost?.contentHtml || '';
  const roughDraftHtml = input.roughDraftHtml !== undefined ? input.roughDraftHtml : existingPost?.roughDraftHtml || '';
  const coverImageUrl = input.coverImageUrl !== undefined ? input.coverImageUrl : existingPost?.coverImageUrl || '';
  const readTimeMinutes = input.readTimeMinutes
    ? Math.max(1, Math.round(Number(input.readTimeMinutes)))
    : computeReadTimeMinutes(contentHtml);
  const nextVersion = Number(previousMeta.version || 0) + 1;

  const metadata = {
    ...previousMeta,
    title: input.title !== undefined ? input.title : existingPost?.title || 'Untitled',
    summary: input.summary !== undefined ? input.summary : existingPost?.summary || '',
    tags: input.tags !== undefined ? input.tags : existingPost?.tags || [],
    privateSeoTags: input.privateSeoTags !== undefined ? input.privateSeoTags : existingPost?.privateSeoTags || [],
    publishDate,
    status: input.status !== undefined ? input.status : existingPost?.status || 'draft',
    category: input.category !== undefined ? input.category : existingPost?.category || 'General',
    readTimeMinutes,
    ...(input.signatureId !== undefined ? { signatureId: input.signatureId || null } : {}),
    ...(input.signatureSnapshot !== undefined ? { signatureSnapshot: input.signatureSnapshot || null } : {}),
    ...(coverImageUrl ? { coverImageUrl } : {}),
    version: nextVersion,
    updatedAt: timestamp,
  };

  if (actor?.sub) {
    metadata.authorUserSub = metadata.authorUserSub || String(actor.sub);
  }
  if (source === 'mcp') {
    metadata.mcpSource = {
      type: 'mcp',
      clientId: String(actor?.clientId || ''),
      clientName: String(actor?.clientName || ''),
      createdAt: metadata.mcpSource?.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  const existingByContentId = new Map(existing.map((item) => [Number(item.PageContentID), item]));
  const withBase = (contentId, fallbackId) => {
    const item = existingByContentId.get(Number(contentId));
    return {
      ...(item || {}),
      ID: item?.ID || fallbackId,
      PageID: BLOG_PAGE_ID,
      PageContentID: contentId,
      ListItemID: listItemID,
      CreatedAt: item?.CreatedAt || timestamp,
      UpdatedAt: timestamp,
    };
  };

  const records = [
    {
      ...withBase(BLOG_ITEM_CONTENT_ID, `blog-item-${listItemID}`),
      Text: metadata.title,
      Metadata: metadata,
    },
    {
      ...withBase(BLOG_TEXT_CONTENT_ID, `blog-text-${listItemID}`),
      Text: contentHtml,
      Metadata: metadata,
    },
    {
      ...withBase(BLOG_BODY_CONTENT_ID, `blog-body-${listItemID}`),
      Text: contentHtml,
      Metadata: metadata,
    },
  ];

  if (roughDraftHtml) {
    records.push({
      ...withBase(BLOG_ROUGH_DRAFT_CONTENT_ID, `blog-rough-${listItemID}`),
      Text: roughDraftHtml,
      Metadata: metadata,
    });
  }

  if (coverImageUrl) {
    records.push({
      ...withBase(BLOG_IMAGE_CONTENT_ID, `blog-image-${listItemID}`),
      Photo: coverImageUrl,
      Metadata: { ...normalizeMetadata(existingByContentId.get(BLOG_IMAGE_CONTENT_ID)?.Metadata), title: metadata.title },
    });
  }

  const keepIds = new Set(records.map((item) => item.ID));
  const deleteIds = existing
    .filter((item) => [BLOG_ROUGH_DRAFT_CONTENT_ID, BLOG_IMAGE_CONTENT_ID].includes(Number(item.PageContentID)))
    .filter((item) => !keepIds.has(item.ID))
    .map((item) => item.ID)
    .filter(Boolean);

  return { listItemID, records, deleteIds, metadata };
}

function assertConcurrency(post, input) {
  if (!post) return;
  const expectedUpdatedAt = normalizeString(input?.expectedUpdatedAt || '', 80);
  if (expectedUpdatedAt && String(post.updatedAt || '') !== expectedUpdatedAt) {
    throw httpError(409, 'Blog post has changed since it was read', {
      expectedUpdatedAt,
      currentUpdatedAt: post.updatedAt,
    });
  }

  if (input?.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(post.version || 0)) {
    throw httpError(409, 'Blog post version is stale', {
      expectedVersion: Number(input.expectedVersion),
      currentVersion: Number(post.version || 0),
    });
  }
}

function assertMcpDraftOwner(post, client) {
  const source = post?.source || {};
  if (post?.status !== 'draft' || source?.type !== 'mcp' || String(source?.clientId || '') !== String(client?.clientId || '')) {
    throw httpError(403, 'MCP clients may only directly update drafts they created');
  }
}

async function listPosts(filters = {}) {
  requireContentStore();
  const all = await ddbScanAllContent();
  const groups = new Map();
  for (const item of all || []) {
    if (Number(item?.PageID) !== BLOG_PAGE_ID) continue;
    const contentId = Number(item?.PageContentID);
    if (!BLOG_RECORD_CONTENT_IDS.includes(contentId)) continue;
    const key = String(item?.ListItemID || '').trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const status = normalizeString(filters.status || 'all', 30).toLowerCase();
  const category = normalizeString(filters.category || '', 120).toLowerCase();
  const tag = normalizeString(filters.tag || '', 80).toLowerCase();
  const search = normalizeString(filters.q || filters.search || '', 200).toLowerCase();
  const after = filters.dateFrom ? new Date(filters.dateFrom).getTime() : 0;
  const before = filters.dateTo ? new Date(filters.dateTo).getTime() : 0;

  let posts = Array.from(groups.values())
    .map((items) => recordsToPost(items, { includeItems: false }))
    .filter(Boolean);

  posts = posts.filter((post) => {
    if (status && status !== 'all' && post.status !== status) return false;
    if (category && String(post.category || '').toLowerCase() !== category) return false;
    if (tag && !(post.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
    if (search) {
      const blob = `${post.title} ${post.summary} ${(post.tags || []).join(' ')} ${(post.privateSeoTags || []).join(' ')} ${post.category}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    const ts = post.publishDate ? new Date(post.publishDate).getTime() : 0;
    if (after && Number.isFinite(after) && ts < after) return false;
    if (before && Number.isFinite(before) && ts > before) return false;
    return true;
  });

  posts.sort((a, b) => {
    const aTs = new Date(a.publishDate || a.updatedAt || 0).getTime() || 0;
    const bTs = new Date(b.publishDate || b.updatedAt || 0).getTime() || 0;
    if (aTs !== bTs) return bTs - aTs;
    return String(a.listItemID).localeCompare(String(b.listItemID));
  });

  const offset = Math.max(0, Number(filters.offset || 0) || 0);
  const limit = Math.max(1, Math.min(100, Number(filters.limit || 25) || 25));
  const pageItems = posts.slice(offset, offset + limit);

  return {
    items: pageItems,
    page: {
      offset,
      limit,
      returned: pageItems.length,
      total: posts.length,
      hasMore: offset + limit < posts.length,
      nextOffset: offset + limit < posts.length ? offset + limit : null,
    },
  };
}

async function getPost(listItemID, { includeItems = true } = {}) {
  requireContentStore();
  const safeId = normalizeString(listItemID, 180);
  if (!safeId) throw httpError(400, 'listItemID is required');
  const items = await getBlogRecordsByListItemId(safeId);
  const post = recordsToPost(items, { includeItems });
  if (!post) throw httpError(404, 'Blog post not found');
  return post;
}

async function createPost(input, { actor = {}, source = 'authoring', draftOnly = false } = {}) {
  requireContentStore();
  const normalized = validateCreateInput(input, { draftOnly });
  if (normalized.listItemID) {
    const existing = await getBlogRecordsByListItemId(normalized.listItemID);
    if (existing && existing.length) throw httpError(409, 'A blog post with that listItemID already exists');
  }
  const built = buildRecordsFromInput(normalized, { actor, source });
  const written = await ddbBatchPutContent(built.records);
  return recordsToPost(written, { includeItems: true });
}

async function updatePost(listItemID, patch, { actor = {}, source = 'authoring', restrictMcpDraftOwner = false } = {}) {
  requireContentStore();
  const safeId = normalizeString(listItemID, 180);
  if (!safeId) throw httpError(400, 'listItemID is required');
  const existingItems = await getBlogRecordsByListItemId(safeId);
  const existingPost = recordsToPost(existingItems, { includeItems: true });
  if (!existingPost) throw httpError(404, 'Blog post not found');
  const normalized = validatePatchInput(patch);
  assertConcurrency(existingPost, normalized);
  if (restrictMcpDraftOwner) assertMcpDraftOwner(existingPost, actor);

  const built = buildRecordsFromInput(
    {
      ...existingPost,
      ...normalized,
      listItemID: safeId,
      status: normalized.status || existingPost.status,
    },
    { existingItems, actor, source }
  );
  const written = await ddbBatchPutContent(built.records);
  for (const id of built.deleteIds) {
    await ddbDeleteContentByIdSafe(id);
  }
  return recordsToPost(written, { includeItems: true });
}

async function ddbDeleteContentByIdSafe(id) {
  const item = await ddbGetContentById(id).catch(() => null);
  if (!item) return;
  await ddbDeleteContentById(id);
}

async function deletePost(listItemID) {
  requireContentStore();
  const safeId = normalizeString(listItemID, 180);
  if (!safeId) throw httpError(400, 'listItemID is required');
  const existing = await getBlogRecordsByListItemId(safeId);
  if (!existing || !existing.length) throw httpError(404, 'Blog post not found');
  let deleted = await ddbDeleteContentByListItemId(safeId);
  if (!deleted) {
    for (const item of existing) {
      if (item?.ID) await ddbDeleteContentByIdSafe(item.ID);
    }
    deleted = existing.length;
  }
  return { ok: true, listItemID: safeId, deleted };
}

function getDefaultCategoriesFromPosts(posts) {
  const bySlug = new Map();
  for (const post of posts || []) {
    const name = normalizeString(post.category || 'General', 120) || 'General';
    const slug = normalizeSlug(name) || 'general';
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      id: slug,
      name,
      slug,
      archived: false,
      derived: true,
    });
  }
  if (!bySlug.has('general')) {
    bySlug.set('general', { id: 'general', name: 'General', slug: 'general', archived: false, derived: true });
  }
  return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function readCategoryRegistryRecord() {
  const item = await ddbGetContentById(CATEGORY_REGISTRY_ID).catch(() => null);
  return item || null;
}

function normalizeRegistry(raw) {
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    categories: categories
      .map((category) => {
        const name = normalizeString(category?.name, 120);
        const slug = normalizeSlug(category?.slug || name);
        if (!name || !slug) return null;
        return {
          id: normalizeString(category?.id || slug, 100) || slug,
          name,
          slug,
          archived: Boolean(category?.archived),
          createdAt: category?.createdAt || null,
          updatedAt: category?.updatedAt || null,
        };
      })
      .filter(Boolean),
  };
}

async function writeCategoryRegistry(registry) {
  const timestamp = nowIso();
  await ddbPutContent({
    ID: CATEGORY_REGISTRY_ID,
    Text: 'Blog category registry',
    PageID: BLOG_PAGE_ID,
    PageContentID: BLOG_CATEGORY_REGISTRY_CONTENT_ID,
    ListItemID: CATEGORY_REGISTRY_LIST_ITEM_ID,
    Metadata: {
      registry: normalizeRegistry(registry),
      updatedAt: timestamp,
    },
    CreatedAt: timestamp,
    UpdatedAt: timestamp,
  });
  return normalizeRegistry(registry);
}

async function listCategories({ includeArchived = false } = {}) {
  requireContentStore();
  const [registryRecord, postPage] = await Promise.all([
    readCategoryRegistryRecord(),
    listPosts({ status: 'all', limit: 100 }),
  ]);
  const registry = normalizeRegistry(normalizeMetadata(registryRecord?.Metadata)?.registry || {});
  const byId = new Map();
  for (const category of getDefaultCategoriesFromPosts(postPage.items || [])) byId.set(category.id, category);
  for (const category of registry.categories) byId.set(category.id, { ...category, derived: false });
  const items = Array.from(byId.values())
    .filter((category) => includeArchived || !category.archived)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { categories: items };
}

async function createCategory(input = {}) {
  requireContentStore();
  const name = normalizeString(input.name, 120);
  if (!name) throw httpError(400, 'Category name is required');
  const slug = normalizeSlug(input.slug || name);
  const existing = await listCategories({ includeArchived: true });
  if (existing.categories.some((category) => category.slug === slug && !category.archived)) {
    throw httpError(409, 'Category already exists');
  }
  const record = await readCategoryRegistryRecord();
  const registry = normalizeRegistry(normalizeMetadata(record?.Metadata)?.registry || {});
  const timestamp = nowIso();
  registry.categories.push({
    id: normalizeString(input.id || slug, 100) || slug,
    name,
    slug,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await writeCategoryRegistry(registry);
  return listCategories({ includeArchived: true });
}

async function updateCategory(id, input = {}) {
  requireContentStore();
  const safeId = normalizeString(id, 100);
  if (!safeId) throw httpError(400, 'Category id is required');
  const record = await readCategoryRegistryRecord();
  const registry = normalizeRegistry(normalizeMetadata(record?.Metadata)?.registry || {});
  const idx = registry.categories.findIndex((category) => category.id === safeId);
  if (idx < 0) throw httpError(404, 'Category not found in registry');
  const current = registry.categories[idx];
  const name = input.name !== undefined ? normalizeString(input.name, 120) : current.name;
  if (!name) throw httpError(400, 'Category name is required');
  registry.categories[idx] = {
    ...current,
    name,
    slug: input.slug !== undefined ? normalizeSlug(input.slug || name) : current.slug,
    archived: input.archived !== undefined ? Boolean(input.archived) : current.archived,
    updatedAt: nowIso(),
  };
  await writeCategoryRegistry(registry);
  return registry.categories[idx];
}

async function archiveCategory(id) {
  return updateCategory(id, { archived: true });
}

async function listSchedules() {
  const { items } = await listPosts({ status: 'all', limit: 100 });
  const schedules = items
    .filter((post) => post.scheduleName || post.status === 'scheduled' || post.scheduledAt)
    .map((post) => ({
      listItemID: post.listItemID,
      title: post.title,
      scheduleName: post.scheduleName || null,
      runAt: post.scheduledAt || post.publishDate || null,
      status: post.status,
      lastError: post.metadata?.scheduleLastError || null,
      updatedAt: post.updatedAt,
    }))
    .sort((a, b) => String(a.runAt || '').localeCompare(String(b.runAt || '')));
  return { schedules };
}

module.exports = {
  BLOG_PAGE_ID,
  BLOG_ITEM_CONTENT_ID,
  BLOG_TEXT_CONTENT_ID,
  BLOG_IMAGE_CONTENT_ID,
  BLOG_BODY_CONTENT_ID,
  BLOG_ROUGH_DRAFT_CONTENT_ID,
  sanitizeBlogHtml,
  recordsToPost,
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  listSchedules,
};
