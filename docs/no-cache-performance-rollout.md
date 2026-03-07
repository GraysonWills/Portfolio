# No-Cache Performance Rollout

Last updated: 2026-03-07

This document captures the current performance architecture for the portfolio platform after the no-cache rollout.

## Objectives

1. Deliver usable page structure and metadata before heavy media.
2. Avoid whole-dataset pulls during route changes.
3. Remove dynamic content caching from the API and browser persistence layers.
4. Keep static assets immutable and aggressively cacheable by filename hash.
5. Reduce cold-start and origin latency without introducing stale dynamic content.

## What Changed

### Dynamic API responses are no longer cached

- API `GET /api/*` responses now return:
  - `Cache-Control: no-store, max-age=0`
  - `Pragma: no-cache`
  - `Expires: 0`
- The old in-process API GET cache middleware was removed.
- Browser-persisted route/content snapshot caches were disabled in both Angular apps.

Allowed reuse that remains:
- in-flight request dedupe (`shareReplay`-based service streams)
- route-scoped in-memory reuse during the active SPA session
- immutable JS/CSS/media asset caching by hashed filename

### New `v3` read-model endpoints

The API now exposes route-specific read models:

- `GET /api/content/v3/bootstrap`
- `GET /api/content/v3/landing`
- `GET /api/content/v3/work`
- `GET /api/content/v3/projects/categories`
- `POST /api/content/v3/projects/items`
- `GET /api/content/v3/blog/:listItemId`
- `GET /api/content/v3/admin/dashboard`
- `GET /api/content/v3/admin/content`

These endpoints shape data for rendering instead of forcing the frontend to:
- load full page buckets
- merge records client-side
- sort/group in the browser
- fetch all pages when only one route is active

### Targeted server reads replaced user-facing scans

Public routes already read by page.

For authoring:
- `v3/admin/dashboard` reads only the blog page bucket.
- `v3/admin/content` now uses:
  - page+content targeted queries when both are selected
  - single-page queries when a page is selected
  - bounded page-index fanout across known pages when viewing “all pages”

This removes the prior full-table scan from the normal Content Studio path.

### Frontend rendering became route-scoped

#### Portfolio

- Shared header/footer data is fetched through `v3/bootstrap`.
- Landing uses `v3/landing` and hydrates hero slides from a metadata-first payload.
- Work uses `v3/work` and paginates the timeline instead of recursively loading all rows.
- Projects uses `v3/projects/categories` plus batched `v3/projects/items`.
- Blog detail uses `v3/blog/:listItemId` with body-block rendering from a single shaped payload.

#### Blog authoring

- Dashboard uses `v3/admin/dashboard`.
- Content Studio uses `v3/admin/content`.
- Route entry no longer triggers diagnostics health checks during normal navigation.

### AWS origin latency improvements

`portfolio-redis-api` was updated to:

- `arm64`
- `1024 MB` memory
- published `live` alias
- provisioned concurrency: `2`

API Gateway now invokes the `live` alias instead of `$LATEST`.

## Current Loading Strategy

### Public portfolio

- Route shell renders first.
- Metadata/text arrives before non-critical media.
- Non-critical images use lazy loading.
- Projects and work timeline append incrementally instead of preloading full page datasets.

### Blog authoring

- Dashboard cards load metadata first.
- Card images hydrate lazily.
- Content Studio pages server-page through filtered rows rather than loading everything locally.

## Read-Model Attributes on Content Records

New/updated content writes now stamp these derived attributes:

- `PagePK`
- `PageSK`
- `UpdatedPK`
- `UpdatedSK`
- `FeedPK`
- `FeedSK`

These are in place so the table can be moved to dedicated read-model GSIs later without another content-shape rewrite.

## Remaining Improvement Path

Not part of the current rollout:

1. Dedicated GSIs for:
   - page render ordering
   - updated-content feeds
   - blog publish feeds
2. Admin route/module splitting so the editor bundle is isolated from non-editor admin routes.
3. `IntersectionObserver`-based sentinel loading to replace scroll-threshold handlers everywhere.
4. Additional media derivative normalization for richer in-post galleries/carousels.

## Verification Checklist

- `GET /api/content/v3/landing` returns `200`.
- Dynamic API responses send `Cache-Control: no-store, max-age=0`.
- Public routes load without recursive all-page fetches.
- Content Studio does not rely on full-table scans in normal operation.
- Lambda alias `live` is active with provisioned concurrency.
- Static asset deployments retain immutable cache headers.
