# Content `v2` Streaming APIs

Last updated: 2026-03-07

Additive read APIs used by `portfolio-app` and `blog-authoring-gui` for metadata-first rendering, batched hydration, and route-scoped in-memory request reuse.

## Goals

1. Render usable text/structure before heavier media.
2. Avoid full dataset pulls on route changes.
3. Preserve backward compatibility (`v1` endpoints remain available).
4. Keep writes unchanged while reads migrate to paged `v2`.
5. Hand off route-specific reads to `v3` where the API can shape responses directly.

## Endpoints

### `GET /api/content/v2/page/:pageId`

Query params:
- `limit` (`1-100`, default `30`)
- `nextToken` (opaque base64 token)
- `contentIds` (comma-separated numeric IDs)
- `fields` (`minimal|standard|full`, default `standard`)
- `sort` (`updated_desc|updated_asc|id_asc`, default `updated_desc`)

Response:

```json
{
  "items": [],
  "nextToken": "opaque-or-null",
  "page": {
    "pageId": 2,
    "limit": 30,
    "returned": 30,
    "hasMore": true,
    "sort": "updated_desc"
  }
}
```

### `GET /api/content/v2/blog/cards`

Query params:
- `limit` (`1-50`, default `12`)
- `nextToken`
- `status` (`published|draft|scheduled|all`, default `published`)
- `includeFuture` (`true|false`, default `false`)
- `q` (title/summary/tag/category search)
- `category`

Response:
- metadata-only blog cards (no image URL in this endpoint)
- pagination token and page summary.

### `GET /api/content/v2/blog/cards/media`

Query params:
- `listItemIDs` (comma-separated IDs, max `50`)

Response:
- sparse media mappings for visible cards only:

```json
{
  "items": [
    { "listItemID": "blog-post-001", "imageUrl": "https://..." }
  ]
}
```

### `POST /api/content/v2/list-items/batch`

Body:
- `listItemIDs` (array, max `50`)
- `contentIds` (optional numeric array)

Response:
- grouped content map keyed by `listItemID`.

## Pagination Token

`nextToken` is base64 JSON:

```json
{
  "mode": "offset",
  "offset": 60,
  "sort": "updated_desc",
  "filterHash": "sha256-of-effective-filters"
}
```

Server rejects tokens when `filterHash` does not match active filters.

## Frontend Integration

Flags in both apps:
- `useContentV2Stream`
- `useBlogV2Cards`

Behavior:
- flag on -> use `v2` APIs.
- `v2` request failure -> fallback to legacy `v1` reads.

`cacheScope` usage:
- clients pass route-specific scope labels in service requests.
- service-layer caches are keyed by route + query shape.
- this keeps in-memory reuse route-local and avoids cross-page data thrash.

## Route Coverage (Current)

Portfolio:
- `/`
- `/work`
- `/projects`
- `/blog`
- `/blog/:id`

Blog authoring:
- `/dashboard` card feed
- `/content` page/content listing
- list-item hydration flows in edit paths.

`v3` now owns these routes in production:
- portfolio `/`, `/work`, `/projects`, `/blog/:id`
- authoring `/dashboard`, `/content`

## Performance Strategy

1. Fetch cards/metadata first.
2. Render visible text cards immediately.
3. Hydrate images with `v2/blog/cards/media` for visible IDs only.
4. Fetch additional pages with `nextToken` when user scrolls/loads more.
5. Reuse only in-flight/session-memory requests; do not persist dynamic snapshots to browser storage.

For the current no-cache rollout and `v3` route models, see:
- `/Users/grayson/Desktop/Portfolio/docs/no-cache-performance-rollout.md`

## Observability

Backend timing logs:
- `GET /api/content/v2/page/:pageId`
- `GET /api/content/v2/blog/cards`
- `GET /api/content/v2/blog/cards/media`
- `POST /api/content/v2/list-items/batch`

Frontend analytics events:
- `cards_rendered_initial`
- `cards_images_hydrated`
- `cards_next_page_loaded`
