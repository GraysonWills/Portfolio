const BLOG_PAGE_ID = 3;
const BLOG_ITEM_CONTENT_ID = 3;
const BLOG_IMAGE_CONTENT_ID = 5;

function clampLimit(value, { defaultValue, min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parsePageSort(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'updated_asc') return 'updated_asc';
  if (raw === 'id_asc') return 'id_asc';
  return 'updated_desc';
}

function parseProjection(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'minimal') return 'minimal';
  if (raw === 'full') return 'full';
  return 'standard';
}

function parseBoolean(value, defaultValue = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'y'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n'].includes(raw)) return false;
  return defaultValue;
}

function parseCsvNumbers(input, { maxItems = 200 } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    if (out.length >= maxItems) break;
    const n = Number(String(part || '').trim());
    if (!Number.isFinite(n)) continue;
    const value = Math.floor(n);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseCsvStrings(input, { maxItems = 200 } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    if (out.length >= maxItems) break;
    const value = String(part || '').trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseStatusFilter(value, fallback = 'published') {
  const raw = String(value || '').trim().toLowerCase();
  if (['published', 'draft', 'scheduled', 'all'].includes(raw)) return raw;
  return fallback;
}

function toMillis(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function safeParseJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeMetadata(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    return safeParseJson(value) || {};
  }
  if (typeof value === 'object') return value;
  return {};
}

function normalizeContentItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    ...item,
    Metadata: normalizeMetadata(item.Metadata)
  };
}

function sortPageItems(items, sort) {
  const rows = [...(Array.isArray(items) ? items : [])];

  if (sort === 'id_asc') {
    rows.sort((a, b) => String(a?.ID || '').localeCompare(String(b?.ID || '')));
    return rows;
  }

  rows.sort((a, b) => {
    const aTs = toMillis(a?.UpdatedAt || a?.CreatedAt);
    const bTs = toMillis(b?.UpdatedAt || b?.CreatedAt);
    if (aTs !== bTs) {
      return sort === 'updated_asc' ? aTs - bTs : bTs - aTs;
    }
    return String(a?.ID || '').localeCompare(String(b?.ID || ''));
  });

  return rows;
}

function projectContentItem(item, fields) {
  if (fields === 'full') {
    return item;
  }

  const base = {
    ID: item.ID,
    PageID: item.PageID,
    PageContentID: item.PageContentID,
    ListItemID: item.ListItemID,
    CreatedAt: item.CreatedAt,
    UpdatedAt: item.UpdatedAt,
    Metadata: item.Metadata
  };

  if (fields === 'minimal') {
    return base;
  }

  return {
    ...base,
    Text: item.Text
  };
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const tag = String(item || '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function toBlogCard(item) {
  const metadata = normalizeMetadata(item?.Metadata);
  const publishDateRaw = metadata.publishDate || item?.UpdatedAt || item?.CreatedAt || null;
  const publishTs = toMillis(publishDateRaw);
  return {
    listItemID: String(item?.ListItemID || '').trim(),
    title: String(metadata.title || item?.Text || 'Untitled'),
    summary: String(metadata.summary || ''),
    publishDate: publishDateRaw ? new Date(publishDateRaw).toISOString() : null,
    _publishTs: publishTs,
    status: String(metadata.status || 'published').toLowerCase(),
    tags: normalizeTagList(metadata.tags),
    privateSeoTags: normalizeTagList(metadata.privateSeoTags),
    readTimeMinutes: Math.max(1, Math.round(Number(metadata.readTimeMinutes || 1))),
    category: String(metadata.category || 'General'),
    _updatedTs: toMillis(item?.UpdatedAt || item?.CreatedAt),
    _searchBlob: [
      metadata.title || item?.Text || '',
      metadata.summary || '',
      ...(Array.isArray(metadata.tags) ? metadata.tags : []),
      ...(Array.isArray(metadata.privateSeoTags) ? metadata.privateSeoTags : []),
      metadata.category || ''
    ].join(' ').toLowerCase()
  };
}

function buildBlogCardsFromPageItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean)
    .filter((item) => Number(item.PageID) === BLOG_PAGE_ID && Number(item.PageContentID) === BLOG_ITEM_CONTENT_ID)
    .map(toBlogCard)
    .filter((card) => card.listItemID);
}

function filterBlogCards(cards, filters) {
  const {
    status = 'published',
    includeFuture = false,
    q = '',
    category = ''
  } = filters || {};

  const now = Date.now();
  const qNorm = String(q || '').trim().toLowerCase();
  const categoryNorm = String(category || '').trim().toLowerCase();

  return (Array.isArray(cards) ? cards : []).filter((card) => {
    if (status !== 'all' && card.status !== status) {
      return false;
    }

    if (!includeFuture && card._publishTs && card._publishTs > now) {
      return false;
    }

    if (categoryNorm && String(card.category || '').trim().toLowerCase() !== categoryNorm) {
      return false;
    }

    if (qNorm && !card._searchBlob.includes(qNorm)) {
      return false;
    }

    return true;
  });
}

function sortBlogCards(cards) {
  return [...(Array.isArray(cards) ? cards : [])].sort((a, b) => {
    if (a._publishTs !== b._publishTs) return b._publishTs - a._publishTs;
    if (a._updatedTs !== b._updatedTs) return b._updatedTs - a._updatedTs;
    return String(a.listItemID || '').localeCompare(String(b.listItemID || ''));
  });
}

function stripBlogCardInternals(card) {
  const { _publishTs, _updatedTs, _searchBlob, ...publicCard } = card;
  return publicCard;
}

function groupItemsByListItemId(items, requestedIds) {
  const out = {};
  for (const id of requestedIds) {
    out[id] = [];
  }

  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.ListItemID || '').trim();
    if (!key || !Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key].push(item);
  }

  return out;
}

function filterByContentIds(items, contentIds) {
  if (!Array.isArray(contentIds) || !contentIds.length) return [...(items || [])];
  const allowed = new Set(contentIds.map((n) => Number(n)));
  return (Array.isArray(items) ? items : []).filter((item) => allowed.has(Number(item?.PageContentID)));
}

function pageSlice(items, offset, limit) {
  const rows = Array.isArray(items) ? items : [];
  const start = Math.max(0, Number(offset) || 0);
  const end = start + Math.max(1, Number(limit) || 1);
  const page = rows.slice(start, end);
  const hasMore = end < rows.length;
  return {
    items: page,
    offset: start,
    nextOffset: end,
    hasMore
  };
}

module.exports = {
  BLOG_PAGE_ID,
  BLOG_IMAGE_CONTENT_ID,
  clampLimit,
  parsePageSort,
  parseProjection,
  parseBoolean,
  parseCsvNumbers,
  parseCsvStrings,
  parseStatusFilter,
  normalizeContentItem,
  sortPageItems,
  projectContentItem,
  buildBlogCardsFromPageItems,
  filterBlogCards,
  sortBlogCards,
  stripBlogCardInternals,
  groupItemsByListItemId,
  filterByContentIds,
  pageSlice
};
