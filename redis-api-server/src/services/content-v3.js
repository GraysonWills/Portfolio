const {
  BLOG_PAGE_ID,
  BLOG_IMAGE_CONTENT_ID,
  clampLimit,
  parseCsvNumbers,
  normalizeContentItem,
  sortPageItems,
  buildBlogCardsFromPageItems,
  filterBlogCards,
  sortBlogCards,
  stripBlogCardInternals,
  pageSlice
} = require('./content-v2');
const { normalizeMetadata, toMillis, getOrderValue } = require('./content-read-model');

const LANDING_PAGE_ID = 0;
const WORK_PAGE_ID = 1;
const PROJECTS_PAGE_ID = 2;

const CONTENT_IDS = {
  HeaderText: 0,
  HeaderIcon: 1,
  FooterIcon: 2,
  BlogItem: 3,
  BlogText: 4,
  BlogImage: 5,
  LandingPhoto: 6,
  LandingText: 7,
  WorkText: 8,
  ProjectsCategoryPhoto: 9,
  ProjectsCategoryText: 10,
  ProjectsPhoto: 11,
  ProjectsText: 12,
  BlogBody: 13,
  WorkSkillMetric: 14,
  BlogRoughDraft: 18
};

function compareByOrderThenId(a, b) {
  const orderDelta = getOrderValue(a) - getOrderValue(b);
  if (orderDelta !== 0) return orderDelta;
  return String(a?.ID || '').localeCompare(String(b?.ID || ''));
}

function getLatestImageUrl(items) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((item) => typeof item?.Photo === 'string' && item.Photo.trim())
    .sort((a, b) => {
      const aTs = toMillis(a?.UpdatedAt || a?.CreatedAt);
      const bTs = toMillis(b?.UpdatedAt || b?.CreatedAt);
      return bTs - aTs;
    });
  return rows[0]?.Photo || null;
}

function parseBlogBodyBlocks(bodyText, fallbackText = '') {
  if (bodyText && typeof bodyText === 'string') {
    try {
      const parsed = JSON.parse(bodyText);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      return [{ type: 'paragraph', content: bodyText }];
    }
  }

  const fallback = String(fallbackText || '').trim();
  return fallback ? [{ type: 'paragraph', content: fallback }] : [];
}

function buildBootstrapPayload(items) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean);
  const headerItems = normalized
    .filter((item) => Number(item.PageContentID) === CONTENT_IDS.HeaderText || Number(item.PageContentID) === CONTENT_IDS.HeaderIcon)
    .sort(compareByOrderThenId);
  const footerItems = normalized
    .filter((item) => Number(item.PageContentID) === CONTENT_IDS.FooterIcon)
    .sort(compareByOrderThenId);

  return {
    header: {
      items: headerItems
    },
    footer: {
      items: footerItems
    }
  };
}

function buildLandingPayload(items) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean);

  const textItems = normalized
    .filter((item) => Number(item.PageID) === LANDING_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.LandingText)
    .sort(compareByOrderThenId);
  const photoItems = normalized
    .filter((item) => Number(item.PageID) === LANDING_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.LandingPhoto)
    .sort(compareByOrderThenId);

  const summaryItem = textItems.find((item) => String(item?.Metadata?.type || '').trim().toLowerCase() === 'summary') || textItems[0] || null;
  const heroSlides = photoItems.map((item, index) => ({
    photo: item.Photo || '',
    alt: String(item?.Metadata?.alt || 'Portfolio hero image'),
    order: getOrderValue(item) || (index + 1)
  })).filter((slide) => !!slide.photo);

  return {
    summary: summaryItem?.Text || '',
    heroSlides
  };
}

function buildWorkPayload(items, { limit = 8, nextOffset = 0 } = {}) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean);

  const metrics = normalized
    .filter((item) => Number(item.PageID) === WORK_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.WorkSkillMetric)
    .sort(compareByOrderThenId);

  const timelineRows = normalized
    .filter((item) => Number(item.PageID) === WORK_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.WorkText)
    .filter((item) => String(item.ListItemID || '').startsWith('experience-'))
    .sort(compareByOrderThenId);

  const sliced = pageSlice(timelineRows, nextOffset, clampLimit(limit, { defaultValue: 8, min: 1, max: 20 }));

  return {
    metrics,
    timeline: {
      items: sliced.items,
      nextOffset: sliced.hasMore ? sliced.nextOffset : null,
      hasMore: sliced.hasMore
    }
  };
}

function buildProjectCategoriesPayload(items, { limit = 12, nextOffset = 0 } = {}) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean);

  const categoryTextRows = normalized
    .filter((item) => Number(item.PageID) === PROJECTS_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.ProjectsCategoryText)
    .sort(compareByOrderThenId);

  const categoryPhotoRows = normalized
    .filter((item) => Number(item.PageID) === PROJECTS_PAGE_ID && Number(item.PageContentID) === CONTENT_IDS.ProjectsCategoryPhoto)
    .sort(compareByOrderThenId);

  const photoByListItemId = new Map(
    categoryPhotoRows.map((item) => [String(item.ListItemID || ''), item])
  );

  const mapped = categoryTextRows.map((item, index) => {
    let parsed = {};
    try {
      parsed = JSON.parse(item.Text || '{}');
    } catch {
      parsed = {};
    }
    const listItemID = String(item.ListItemID || '').trim();
    const photoItem = photoByListItemId.get(listItemID);
    return {
      listItemID,
      name: String(parsed?.name || item.Text || 'Uncategorized'),
      description: String(parsed?.description || ''),
      categoryPhoto: photoItem?.Photo || null,
      order: getOrderValue(item) || (index + 1)
    };
  }).filter((item) => !!item.listItemID);

  const sliced = pageSlice(mapped, nextOffset, clampLimit(limit, { defaultValue: 12, min: 1, max: 50 }));

  return {
    items: sliced.items,
    nextOffset: sliced.hasMore ? sliced.nextOffset : null,
    hasMore: sliced.hasMore
  };
}

function buildProjectItemsPayload(items, categoryIds) {
  const requested = new Set((Array.isArray(categoryIds) ? categoryIds : []).map((id) => String(id || '').trim()).filter(Boolean));
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean)
    .filter((item) => requested.has(String(item.ListItemID || '').trim()))
    .sort(compareByOrderThenId);

  const grouped = {};
  for (const id of requested) {
    grouped[id] = [];
  }

  for (const item of normalized) {
    const key = String(item.ListItemID || '').trim();
    if (!key || !grouped[key]) continue;
    grouped[key].push(item);
  }

  return {
    itemsByCategoryId: grouped
  };
}

function buildBlogDetailPayload(items) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean)
    .sort(compareByOrderThenId);

  const metaItem = normalized.find((item) => Number(item.PageContentID) === CONTENT_IDS.BlogItem && item.Metadata)
    || normalized.find((item) => !!item.Metadata)
    || null;
  const textItem = normalized.find((item) => Number(item.PageContentID) === CONTENT_IDS.BlogText && !!item.Text) || null;
  const imageItem = normalized.find((item) => Number(item.PageContentID) === CONTENT_IDS.BlogImage && !!item.Photo) || null;
  const bodyItem = normalized.find((item) => Number(item.PageContentID) === CONTENT_IDS.BlogBody && !!item.Text) || null;
  const roughDraftItem = normalized.find((item) => Number(item.PageContentID) === CONTENT_IDS.BlogRoughDraft && !!item.Text) || null;
  const metadata = normalizeMetadata(metaItem?.Metadata);
  const publishDate = metadata.publishDate || null;
  const publishTs = toMillis(publishDate);
  const status = String(metadata.status || 'published').trim().toLowerCase() === 'published' && Number.isFinite(publishTs) && publishTs > Date.now()
    ? 'scheduled'
    : String(metadata.status || 'published').trim().toLowerCase();

  return {
    listItemID: String(metaItem?.ListItemID || textItem?.ListItemID || imageItem?.ListItemID || '').trim(),
    title: String(metadata.title || 'Untitled'),
    summary: String(metadata.summary || textItem?.Text || ''),
    coverImage: imageItem?.Photo || '',
    coverAlt: String(imageItem?.Metadata?.alt || metadata.title || 'Blog cover image'),
    publishDate,
    status,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    privateSeoTags: Array.isArray(metadata.privateSeoTags) ? metadata.privateSeoTags : [],
    category: String(metadata.category || 'General'),
    readTimeMinutes: Number.isFinite(Number(metadata.readTimeMinutes))
      ? Math.max(1, Math.round(Number(metadata.readTimeMinutes)))
      : Math.max(1, Math.ceil(String(textItem?.Text || '').split(/\s+/).filter(Boolean).length / 200)),
    signature: metadata.signatureSnapshot || null,
    bodyBlocks: parseBlogBodyBlocks(bodyItem?.Text, textItem?.Text || ''),
    roughDraftBlocks: roughDraftItem ? parseBlogBodyBlocks(roughDraftItem.Text, '') : []
  };
}

function buildAdminDashboardPayload(items, { limit = 20, nextOffset = 0, q = '', category = '' } = {}) {
  const cards = sortBlogCards(
    filterBlogCards(
      buildBlogCardsFromPageItems(items),
      {
        status: 'all',
        includeFuture: true,
        q,
        category
      }
    )
  );

  const counts = cards.reduce((acc, card) => {
    const key = String(card.status || 'draft').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { draft: 0, scheduled: 0, published: 0 });

  const sliced = pageSlice(cards, nextOffset, clampLimit(limit, { defaultValue: 20, min: 1, max: 50 }));

  return {
    items: sliced.items.map(stripBlogCardInternals),
    nextOffset: sliced.hasMore ? sliced.nextOffset : null,
    hasMore: sliced.hasMore,
    counts
  };
}

function filterAdminContent(items, { pageId = null, contentId = null, q = '' } = {}) {
  const rows = (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean)
    .filter((item) => {
      if (pageId !== null && pageId !== undefined && Number(pageId) !== -1 && Number(item.PageID) !== Number(pageId)) {
        return false;
      }
      if (contentId !== null && contentId !== undefined && Number(contentId) !== -1 && Number(item.PageContentID) !== Number(contentId)) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.ID,
        item.ListItemID,
        item.Text,
        item.Photo,
        JSON.stringify(item.Metadata || {})
      ].join(' ').toLowerCase();
      return haystack.includes(String(q).trim().toLowerCase());
    });

  return sortPageItems(rows, 'updated_desc');
}

function buildAdminContentPayload(items, options = {}) {
  const rows = filterAdminContent(items, options);
  const limit = clampLimit(options.limit, { defaultValue: 50, min: 1, max: 100 });
  const nextOffset = Math.max(0, Number(options.nextOffset) || 0);
  const sliced = pageSlice(rows, nextOffset, limit);

  return {
    items: sliced.items,
    nextOffset: sliced.hasMore ? sliced.nextOffset : null,
    hasMore: sliced.hasMore
  };
}

module.exports = {
  BLOG_PAGE_ID,
  CONTENT_IDS,
  LANDING_PAGE_ID,
  WORK_PAGE_ID,
  PROJECTS_PAGE_ID,
  buildBootstrapPayload,
  buildLandingPayload,
  buildWorkPayload,
  buildProjectCategoriesPayload,
  buildProjectItemsPayload,
  buildBlogDetailPayload,
  buildAdminDashboardPayload,
  buildAdminContentPayload,
  getLatestImageUrl,
  parseCsvNumbers
};
