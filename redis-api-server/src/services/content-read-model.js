const BLOG_PAGE_ID = 3;
const BLOG_ITEM_CONTENT_ID = 3;

const MAX_SORT_TS = 9_999_999_999_999;

function safeJsonParse(value) {
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
    return safeJsonParse(value) || {};
  }
  if (typeof value === 'object') return value;
  return {};
}

function toMillis(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function padNumber(value, width) {
  const normalized = Math.max(0, Number(value) || 0);
  return String(Math.trunc(normalized)).padStart(width, '0');
}

function getOrderValue(item) {
  const metadata = normalizeMetadata(item?.Metadata);
  const raw = Number(metadata?.order);
  if (Number.isFinite(raw) && raw >= 0) {
    return Math.trunc(raw);
  }
  return 999_999;
}

function toInvertedTimestamp(ts) {
  const safeTs = Math.max(0, Number(ts) || 0);
  return padNumber(MAX_SORT_TS - safeTs, 13);
}

function decorateContentItemForReadModels(item) {
  if (!item || typeof item !== 'object') return item;

  const metadata = normalizeMetadata(item.Metadata);
  const pageId = Number(item.PageID);
  const pageContentId = Number(item.PageContentID);
  const listItemID = String(item.ListItemID || '-').trim() || '-';
  const createdAt = item.CreatedAt || new Date().toISOString();
  const updatedAt = item.UpdatedAt || createdAt;
  const updatedTs = toMillis(updatedAt || createdAt);
  const orderValue = getOrderValue({ ...item, Metadata: metadata });

  const decorated = {
    ...item,
    Metadata: metadata,
    PagePK: `PAGE#${pageId}`,
    PageSK: `TYPE#${padNumber(pageContentId, 4)}#ORDER#${padNumber(orderValue, 6)}#LIST#${listItemID}#ID#${String(item.ID || '')}`,
    UpdatedPK: `PAGE#${pageId}`,
    UpdatedSK: `TS#${toInvertedTimestamp(updatedTs)}#ID#${String(item.ID || '')}`
  };

  if (pageId === BLOG_PAGE_ID && pageContentId === BLOG_ITEM_CONTENT_ID && listItemID !== '-') {
    const status = String(metadata.status || 'published').trim().toLowerCase() || 'published';
    const publishTs = toMillis(metadata.publishDate || updatedAt || createdAt);
    decorated.FeedPK = `BLOG#${status}`;
    decorated.FeedSK = `TS#${toInvertedTimestamp(publishTs)}#${listItemID}`;
  } else {
    delete decorated.FeedPK;
    delete decorated.FeedSK;
  }

  return decorated;
}

module.exports = {
  decorateContentItemForReadModels,
  normalizeMetadata,
  toMillis,
  getOrderValue
};
