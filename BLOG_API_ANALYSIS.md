# Blog Detail API Endpoint & Payload Builder Analysis

## 1. GET `/api/content/v3/blog/:listItemId` Route Handler

**File:** `redis-api-server/src/routes/content.js` (lines 533-572)

### Handler Logic:
```javascript
router.get('/v3/blog/:listItemId', async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const listItemId = String(req.params.listItemId || '').trim();
    if (!listItemId) {
      return res.status(400).json({ error: 'Invalid listItemId' });
    }

    const items = await readContentByListItemIds([listItemId]);
    const payload = buildBlogDetailPayload(items);
    if (!payload.listItemID) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const publishTs = payload.publishDate ? new Date(payload.publishDate).getTime() : 0;
    const isVisible = payload.status === 'published' && !(publishTs && publishTs > Date.now());
    if (!isVisible) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    logV2Metric('/v3/blog/:listItemId', startedAt, {
      listItemId,
      blocks: Array.isArray(payload.bodyBlocks) ? payload.bodyBlocks.length : 0
    });

    if (payload.coverImage) {
      payload.coverImage = normalizeContentRecord({ Photo: payload.coverImage }, req)?.Photo || payload.coverImage;
    }

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
```

### Key Points:
- **Public endpoint** - requires no authentication
- **Visibility Logic:** Returns 404 if:
  - Post status is NOT 'published', OR
  - Post has a publishDate in the future (scheduled but not yet published)
- Normalizes cover image URL via `normalizeContentRecord()`
- Logs metrics with block count

---

## 2. `buildBlogDetailPayload()` Function

**File:** `redis-api-server/src/services/content-v3.js` (lines 209-245)

### Complete Function:
```javascript
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
    coverAlt: String(imageImage?.Metadata?.alt || metadata.title || 'Blog cover image'),
    publishDate,
    status,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    privateSeoTags: Array.isArray(metadata.privateSeoTags) ? metadata.privateSeoTags : [],
    category: String(metadata.category || 'General'),
    readTimeMinutes: Number.isFinite(Number(metadata.readTimeMinutes))
      ? Math.max(1, Math.round(Number(metadata.readTimeMinutes)))
      : Math.max(1, Math.ceil(String(textItem?.Text || '').split(/\s+/).filter(Boolean).length / 200)),
    signature: metadata.signatureSnapshot || null,
    bodyBlocks: parseBlogBodyBlocks(bodyItem?.Text, textItem?.Text || '')
  };
}
```

### Data Assembly Process:

**Items Retrieved by ListItemID:**
1. **metaItem** (PageContentID=3, BlogItem) - Primary metadata source, contains all metadata JSON
2. **textItem** (PageContentID=4, BlogText) - Summary text fallback
3. **imageItem** (PageContentID=5, BlogImage) - Cover photo
4. **bodyItem** (PageContentID=13, BlogBody) - Primary body content (preferred over BlogText)

**Returned Payload:**
- `listItemID`: From metaItem, fallback to textItem/imageItem
- `title`: From metadata.title
- `summary`: From metadata.summary, fallback to textItem.Text
- `coverImage`: From imageItem.Photo
- `coverAlt`: From imageItem metadata alt property, fallback to title
- `publishDate`: From metadata.publishDate
- `status`: **Smart calculation**:
  - If metadata.status === 'published' AND publishDate > now() → 'scheduled'
  - Otherwise → metadata.status (default 'published')
- `tags`: Array from metadata.tags
- `privateSeoTags`: Array from metadata.privateSeoTags
- `category`: From metadata.category (default 'General')
- `readTimeMinutes`: From metadata.readTimeMinutes OR auto-calculated from word count (÷200)
- `signature`: snapshot object from metadata.signatureSnapshot
- `bodyBlocks`: Parsed from bodyItem.Text OR fallback to textItem.Text (see parseBlogBodyBlocks)

### Status Constants (CONTENT_IDS):
```
BlogItem: 3
BlogText: 4
BlogImage: 5
BlogBody: 13
```

---

## 3. Blog Cards Building (v2 - Used in Admin Dashboard)

**File:** `redis-api-server/src/services/content-v2.js`

### buildBlogCardsFromPageItems() - lines 203-210:
```javascript
function buildBlogCardsFromPageItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeContentItem)
    .filter(Boolean)
    .filter((item) => Number(item.PageID) === BLOG_PAGE_ID && Number(item.PageContentID) === BLOG_ITEM_CONTENT_ID)
    .map(toBlogCard)
    .filter((card) => card.listItemID);
}
```

### toBlogCard() - lines 177-201:
Converts content items to card format with:
- listItemID
- title (from metadata.title or item.Text)
- summary (from metadata.summary)
- publishDate (from metadata or UpdatedAt/CreatedAt)
- status (uses `normalizeBlogStatus()`)
- tags, privateSeoTags
- readTimeMinutes
- category
- Internal fields: `_publishTs`, `_updatedTs`, `_searchBlob`

### normalizeBlogStatus() - lines 164-175:
```javascript
function normalizeBlogStatus(status, publishTs) {
  const normalized = String(status || 'published').trim().toLowerCase() || 'published';
  if (normalized !== 'published') {
    return normalized;  // Returns 'draft' or 'scheduled' as-is
  }

  if (Number.isFinite(publishTs) && publishTs > Date.now()) {
    return 'scheduled';  // Published status with future date becomes scheduled
  }

  return 'published';
}
```

### Blog Card Filtering - filterBlogCards() - lines 212-243:
- `status` filter: 'published', 'draft', 'scheduled', or 'all'
- `includeFuture`: Whether to include scheduled (future date) posts
- `q`: Search query (searches `_searchBlob`)
- `category`: Filter by category

---

## 4. DynamoDB Queries for ListItemID

**File:** `redis-api-server/src/services/content-ddb.js` (lines 160-181)

### ddbGetContentByListItemId():
```javascript
async function ddbGetContentByListItemId(listItemId) {
  const tableName = requireTableName();
  const ddb = getDdbDoc();
  const items = [];

  let ExclusiveStartKey = undefined;
  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'ListItemIndex',  // GSI on ListItemID
        KeyConditionExpression: 'ListItemID = :lid',
        ExpressionAttributeValues: { ':lid': listItemId },
        ExclusiveStartKey,
      })
    );
    if (Array.isArray(resp?.Items)) items.push(...resp.Items);
    ExclusiveStartKey = resp?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}
```

### Database Details:
- Uses **ListItemIndex** (Global Secondary Index)
- Queries by `ListItemID` partition key
- Handles pagination with `ExclusiveStartKey`
- Returns all content items with that ListItemID
- Matching items come in: BlogItem, BlogText, BlogBody, BlogImage with same ListItemID

---

## 5. Draft & Status Concepts in System

### Status Values:
- **'draft'**: Unpublished post, user is still working on it
- **'published'**: Live/public post
- **'scheduled'**: Post has a future publishDate, will auto-publish

### Metadata Fields (stored in item.Metadata JSON):
- `status`: 'draft' | 'scheduled' | 'published'
- `publishDate`: ISO datetime string
- `title`: Post title
- `summary`: Short excerpt
- `tags`: Array of public tags
- `privateSeoTags`: Array of SEO-only tags
- `category`: Post category
- `readTimeMinutes`: Manual read time override
- `signatureId`: References a signature template
- `signatureSnapshot`: Full signature object (quote, author, etc.)

### Visibility Rules:
**Public `/api/content/v3/blog/:listItemId` endpoint:**
- Returns 404 if status !== 'published'
- Returns 404 if status === 'published' but publishDate > now() (scheduled)
- **Draft posts are completely hidden from public**

**Admin endpoints (require auth):**
- `/api/content/v3/admin/dashboard` - Shows all posts with status counts
- `/api/content/v3/admin/content` - Shows detailed admin records
- Can filter by status: 'all', 'published', 'draft', 'scheduled'

### No "Multiple Versions" Concept:
- No draft/published version splitting in data model
- Only single metadata set per ListItemID
- Status is a metadata field, not separate table
- Editing always updates the same records (BlogItem, BlogText, BlogBody, BlogImage)

---

## 6. Blog Authoring GUI - Content Saving

**File:** `blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.ts`

### Status Options (lines 43-46):
```typescript
statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' }
];
// Note: 'scheduled' is NOT in UI dropdown, but calculated if publishDate is future
```

### BlogBody vs BlogText Distinction:
Both are saved with **identical content** but different PageContentID:

**BlogText (PageContentID=4):**
- Saved in createBlogPost/updateBlogPost with `content` parameter
- Historical/legacy field
- Used as fallback for summary in buildBlogDetailPayload

**BlogBody (PageContentID=13):**
- Saved in createBlogPost/updateBlogPost with same `content` parameter
- **PREFERRED by public detail route** - parseBlogBodyBlocks() tries bodyItem first
- Newer field, intended to replace BlogText

### Save Process (lines 1182-1264):
1. **createBlogPost()** creates 3-4 items:
   - `BlogItem` (PageContentID=3) - Metadata carrier
   - `BlogText` (PageContentID=4) - Body content copy
   - `BlogBody` (PageContentID=13) - Body content copy (preferred)
   - `BlogImage` (PageContentID=5) - If image provided

2. **updateBlogPost()** - Updates existing items:
   - Fetches current items via getBlogPost()
   - Re-uses existing IDs and CreatedAt timestamps
   - Updates Text, Metadata fields
   - Preserves CreatedAt from original

### Metadata Structure in Save (lines 1000-1015):
```typescript
const metadata: BlogPostMetadata = {
  title: this.getPreviewTitle(),
  summary: this.getPreviewSummary(),
  tags: this.getPreviewTags(),
  privateSeoTags: this.getPreviewPrivateSeoTags(),
  publishDate: safePublishDate,
  status: (formValue.status || 'draft'),
  ...(formValue.category ? { category: String(formValue.category).trim() } : {}),
  previewBypassVisibility: true  // FOR PREVIEW ONLY, not actual saves
};
```

**All 3 items (BlogItem, BlogText, BlogBody) get identical Metadata JSON**

### Status Transitions:
- Draft → Draft: No special handling
- Draft → Published: Saves status='published'
- Any → Scheduled: If publishDate > now, API auto-calculates as 'scheduled'
- Published → Draft: Directly updates status='draft'

### Content Normalization:
- Editor content is HTML
- Sent to API as string in `Text` field
- parseBlogBodyBlocks() parses it as JSON array if possible
  ```javascript
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
  ```
- If not valid JSON, wraps in `[{ type: 'paragraph', content: bodyText }]`

### API Endpoints:
- POST `/api/content/batch` - Both create and update send items here
- Backend merges/upserts based on ID matching

---

## Summary

### Core Concept:
A blog post is represented by **multiple content records sharing a ListItemID**:
- BlogItem: Metadata container
- BlogText: Body copy (legacy)
- BlogBody: Body copy (preferred, newer)
- BlogImage: Cover photo

All records have same ListItemID, fetched together, assembled into single payload.

### Status Handling:
```
Metadata.status + Metadata.publishDate → Calculated Status
'draft' + any date                    → 'draft'
'published' + past/now date          → 'published' (visible publicly)
'published' + future date            → 'scheduled' (NOT visible publicly)
'scheduled' + any date               → 'scheduled' (NOT visible publicly)
```

### Data Flow for Public View:
1. GET /api/content/v3/blog/blog-123
2. readContentByListItemIds(['blog-123']) → queries ListItemIndex
3. buildBlogDetailPayload() assembles 4 items into 1 payload
4. Visibility check: status==='published' AND publishDate <= now
5. Return JSON with bodyBlocks (parsed from BlogBody or BlogText)

### Draft Handling:
- **Drafts NEVER appear on public blog**
- Only stored as status='draft' in metadata
- Visible only in authenticated admin endpoints
- No separate "draft table" or "draft version"
- Edit flow updates same records in-place
