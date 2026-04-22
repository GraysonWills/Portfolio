# Blog API - Quick Reference & Implementation Notes

## File Locations

| Purpose | File Path |
|---------|-----------|
| Route handlers | `redis-api-server/src/routes/content.js` |
| Payload builders v3 | `redis-api-server/src/services/content-v3.js` |
| Blog card builders v2 | `redis-api-server/src/services/content-v2.js` |
| DynamoDB queries | `redis-api-server/src/services/content-ddb.js` |
| Read model utilities | `redis-api-server/src/services/content-read-model.js` |
| Editor component | `blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.ts` |
| Blog API service | `blog-authoring-gui/src/app/services/blog-api.service.ts` |

---

## Content ID Constants

From `content-v3.js` lines 20-36:

```javascript
const CONTENT_IDS = {
  HeaderText: 0,
  HeaderIcon: 1,
  FooterIcon: 2,
  BlogItem: 3,           // Metadata container
  BlogText: 4,           // Body content (legacy)
  BlogImage: 5,          // Cover photo
  LandingPhoto: 6,
  LandingText: 7,
  WorkText: 8,
  ProjectsCategoryPhoto: 9,
  ProjectsCategoryText: 10,
  ProjectsPhoto: 11,
  ProjectsText: 12,
  BlogBody: 13,          // Body content (preferred)
  WorkSkillMetric: 14
};
```

**For blogs, you need:**
- BlogItem (3) for metadata
- BlogText (4) OR BlogBody (13) for content
- BlogImage (5) for cover (optional)

---

## API Endpoints

### Public Endpoints

#### GET `/api/content/v3/blog/:listItemId`
**File:** `content.js` lines 537-572

```javascript
router.get('/v3/blog/:listItemId', async (req, res) => {
  // Returns 404 if:
  // - status !== 'published'
  // - status === 'published' but publishDate > Date.now()
  
  const items = await readContentByListItemIds([listItemId]);
  const payload = buildBlogDetailPayload(items);
  
  const publishTs = payload.publishDate ? new Date(payload.publishDate).getTime() : 0;
  const isVisible = payload.status === 'published' && !(publishTs && publishTs > Date.now());
  if (!isVisible) {
    return res.status(404).json({ error: 'Blog post not found' });
  }
  
  return res.json(payload);
});
```

**Response Shape:**
```json
{
  "listItemID": "blog-123",
  "title": "Post Title",
  "summary": "Short excerpt",
  "coverImage": "https://...",
  "coverAlt": "Alt text",
  "publishDate": "2025-03-15T10:00:00Z",
  "status": "published" | "draft" | "scheduled",
  "tags": ["tag1", "tag2"],
  "privateSeoTags": ["seo1", "seo2"],
  "category": "Tech",
  "readTimeMinutes": 5,
  "signature": { "signOffName": "...", "quote": "...", ... } | null,
  "bodyBlocks": [
    { "type": "paragraph", "content": "..." },
    { "type": "paragraph", "content": "..." }
  ]
}
```

#### GET `/api/content/v3/admin/dashboard` (Auth Required)
**File:** `content.js` lines 576-628

- Shows all blog posts with status counts
- Supports: `limit`, `q` (search), `category` filters
- Returns: items array + hasMore/nextToken for pagination

#### GET `/api/content/v3/admin/content` (Auth Required)
**File:** `content.js` lines 632-...

- Raw admin content view
- Lists individual items (BlogItem, BlogText, BlogBody, BlogImage)
- Full filtering and search

---

## Reading Blog Records from Database

### Function: readContentByListItemIds()
**File:** `content.js` lines 177-195

```javascript
async function readContentByListItemIds(listItemIds) {
  const requested = Array.isArray(listItemIds) ? listItemIds : [];
  if (!requested.length) return [];

  if (useDdbAsPrimary) {
    const groups = await Promise.all(
      requested.map((id) => ddbGetContentByListItemId(id))
    );
    return groups.flat();
  }

  // Falls back to DDB if Redis fails
  const requestedSet = new Set(requested);
  try {
    return await getContentWhere((item) => 
      requestedSet.has(String(item.ListItemID || ''))
    );
  } catch (err) {
    if (!isContentDdbEnabled()) throw err;
    const groups = await Promise.all(
      requested.map((id) => ddbGetContentByListItemId(id))
    );
    return groups.flat();
  }
}
```

### DynamoDB Query: ddbGetContentByListItemId()
**File:** `content-ddb.js` lines 160-181

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
        IndexName: 'ListItemIndex',    // GSI on ListItemID
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

**Returns:** Array of all records with that ListItemID (BlogItem, BlogText, BlogBody, BlogImage all share same ListItemID)

---

## Payload Building: buildBlogDetailPayload()
**File:** `content-v3.js` lines 209-245

### Input:
Array of content items with same ListItemID (BlogItem, BlogText, BlogBody, BlogImage)

### Processing:

1. **Find each type:**
   ```javascript
   const metaItem = normalized.find((item) => 
     Number(item.PageContentID) === CONTENT_IDS.BlogItem && item.Metadata
   ) || normalized.find((item) => !!item.Metadata) || null;
   
   const textItem = normalized.find((item) => 
     Number(item.PageContentID) === CONTENT_IDS.BlogText && !!item.Text
   ) || null;
   
   const bodyItem = normalized.find((item) => 
     Number(item.PageContentID) === CONTENT_IDS.BlogBody && !!item.Text
   ) || null;
   
   const imageItem = normalized.find((item) => 
     Number(item.PageContentID) === CONTENT_IDS.BlogImage && !!item.Photo
   ) || null;
   ```

2. **Extract metadata:**
   ```javascript
   const metadata = normalizeMetadata(metaItem?.Metadata);
   const publishDate = metadata.publishDate || null;
   const publishTs = toMillis(publishDate);
   ```

3. **Calculate status (smart logic):**
   ```javascript
   const status = String(metadata.status || 'published').trim().toLowerCase() === 'published' 
     && Number.isFinite(publishTs) 
     && publishTs > Date.now()
     ? 'scheduled'
     : String(metadata.status || 'published').trim().toLowerCase();
   ```
   - If status is 'published' AND publishDate is in future → return 'scheduled'
   - Otherwise return the status from metadata (default 'published')

4. **Parse body blocks:**
   ```javascript
   bodyBlocks: parseBlogBodyBlocks(bodyItem?.Text, textItem?.Text || '')
   ```
   - Prefers bodyItem (newer)
   - Falls back to textItem (legacy)

### Output:
Single payload object with all blog data merged

---

## Metadata Structure

### Where Stored:
Every record (BlogItem, BlogText, BlogBody, BlogImage) has a `Metadata` field containing JSON string

### Content:
```javascript
{
  "title": "Post Title",
  "summary": "Short description",
  "tags": ["tag1", "tag2"],
  "privateSeoTags": ["seo1"],
  "publishDate": "2025-03-15T10:00:00Z",
  "status": "draft" | "published" | "scheduled",
  "category": "Technology",
  "readTimeMinutes": 5,
  "signatureId": "sig-123",
  "signatureSnapshot": {
    "id": "sig-123",
    "signOffName": "Author Name",
    "quote": "Quote text",
    "quoteAuthor": "Someone",
    "label": "Label"
  }
}
```

### Default Values:
- `status`: defaults to 'published'
- `publishDate`: defaults to now() (current time)
- `tags`: defaults to []
- `privateSeoTags`: defaults to []
- `category`: defaults to 'General'
- `readTimeMinutes`: auto-calculated if missing (wordCount ÷ 200)

---

## Blog Editor - Content Saving

### File: `blog-editor.component.ts`

#### Status Form Control (line 99):
```typescript
status: ['published', [Validators.required]],
```

#### Status Options (lines 43-46):
```typescript
statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' }
];
// 'scheduled' auto-calculated if publishDate > now
```

#### Metadata Construction (lines 1000-1015):
```typescript
const metadata: BlogPostMetadata = {
  title: this.getPreviewTitle(),
  summary: this.getPreviewSummary(),
  tags: this.getPreviewTags(),
  privateSeoTags: this.getPreviewPrivateSeoTags(),
  publishDate: safePublishDate,
  status: (formValue.status || 'draft'),
  ...(formValue.category ? { category: String(formValue.category).trim() } : {}),
  previewBypassVisibility: true  // PREVIEW ONLY
};
```

#### Creating Record Items (lines 1025-1062):
```javascript
// BlogItem (metadata container)
{ ID: blogItemId, PageID: 3, PageContentID: 3, ... Metadata: metadata }

// BlogText (body - legacy)
{ ID: blogTextId, PageID: 3, PageContentID: 4, Text: contentValue, Metadata: metadata }

// BlogBody (body - preferred)
{ ID: blogBodyId, PageID: 3, PageContentID: 13, Text: contentValue, Metadata: metadata }

// BlogImage (cover - optional)
{ ID: blogImageId, PageID: 3, PageContentID: 5, Photo: imageUrl }
```

### API Service: `blog-api.service.ts`

#### Create Blog Post (lines 1182-1263):
```typescript
createBlogPost(
  title: string,
  content: string,
  summary: string,
  tags: string[],
  privateSeoTags: string[],
  image?: string,
  listItemID?: string,
  publishDate?: Date,
  status?: 'draft' | 'scheduled' | 'published',
  category?: string,
  readTimeMinutes?: number,
  signatureId?: string,
  signatureSnapshot?: BlogSignature
): Observable<RedisContent[]>
```

- Creates BlogItem, BlogText, BlogBody with same listItemID
- Posts to `/api/content/batch`

#### Update Blog Post (lines 1264-1340+):
```typescript
updateBlogPost(
  listItemID: string,
  title: string,
  content: string,
  ...same params...
): Observable<RedisContent[]>
```

- Fetches current items via getBlogPost(listItemID)
- Re-uses existing IDs and CreatedAt timestamps
- Updates same records in-place
- Also posts to `/api/content/batch`

---

## Body Content Parsing

### parseBlogBodyBlocks()
**File:** `content-v3.js` lines 55-67

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

### Behavior:
- Tries to parse `Text` field as JSON array
- If JSON parses and is non-empty array → return it
- If JSON parse fails or not array → wrap raw text: `[{ type: 'paragraph', content: ... }]`
- If no bodyText, fallback to fallbackText with same wrapping
- If both empty → return empty array `[]`

### Expected Structure (JSON in Text field):
```json
[
  { "type": "paragraph", "content": "..." },
  { "type": "heading", "content": "..." },
  { "type": "list", "items": [...] }
]
```

If not JSON, treated as plain text paragraph.

---

## Visibility & Access Control

### Public Blog Detail Endpoint: `/api/content/v3/blog/:listItemId`
**Returns 404 (not found) if:**
1. Post status !== 'published', OR
2. Post has status='published' but publishDate > Date.now()

**Returns payload if:**
- status === 'published' AND
- publishDate <= Date.now() (or no publishDate)

### Admin Endpoints
- Require authentication
- Can filter by status: 'all', 'published', 'draft', 'scheduled'
- Show scheduled (future) posts
- Show draft posts

### Draft Handling
- **No separate table or version storage**
- Draft = record with status='draft' in metadata
- Draft records are same storage as published
- Only visibility filtering differs (admin vs public)

---

## Key Implementation Details

### No Draft/Published Split
- Single set of records per blog post
- Status is metadata field, not structural difference
- Update overwrites previous version (no versioning)
- History only via UpdatedAt timestamp

### Multiple Records, One Post
- BlogItem = metadata container (required)
- BlogText = body content copy (legacy, keep for compatibility)
- BlogBody = body content copy (newer, preferred by API)
- BlogImage = cover photo (optional)

All share same `ListItemID`, fetched together, merged into one payload.

### Content Duplication
- `Text` field value is **identical** in both BlogText and BlogBody
- Both get saved in createBlogPost/updateBlogPost
- Avoids migration path issues
- Public API prefers BlogBody (newer field)

### Metadata Sharing
- **All 3 text items (BlogItem, BlogText, BlogBody) get identical Metadata JSON**
- Changes to status/tags/category are applied to all 3
- Image records have separate optional Metadata

---

## Important Notes for Implementation

1. **Query by ListItemID always returns multiple records**
   - Don't assume single record per post
   - Need to filter by PageContentID if you need specific type

2. **buildBlogDetailPayload() is idempotent**
   - Calling with different orderings of same items → same output
   - Safe for frontend caching

3. **Status calculation is automatic**
   - metadata.status + metadata.publishDate → calculated status
   - System "upgrades" published+future → scheduled
   - Frontend form has status='draft'|'published', backend adds 'scheduled' logic

4. **Body content may be JSON or plain text**
   - parseBlogBodyBlocks() handles both
   - If saved as JSON array blocks → returns as-is
   - If saved as plain HTML string → wraps in paragraph block

5. **Image normalization**
   - coverImage URL is normalized via normalizeContentRecord()
   - Uses CDN/edge URL transformation
   - Happens in route handler after buildBlogDetailPayload()

6. **Draft posts return 404 to public**
   - Not filtered out silently
   - Same response as non-existent post
   - Can't enumerate draft posts via list endpoint
