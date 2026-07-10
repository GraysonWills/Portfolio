# Bounded Public-Cache Performance Rollout

Last updated: 2026-07-10

This document describes the portfolio performance architecture after replacing the
blanket no-cache policy with narrow, anonymous, success-only edge caching.

## Objectives

1. Deliver usable page structure before non-critical media.
2. Keep authenticated, mutable, preview, comment, and write traffic uncached.
3. Cache only explicitly reviewed anonymous GET read models.
4. Prevent errors, private metadata, and viewer rate-limit state from entering a shared cache.
5. Reduce Lambda cold-path work instead of paying for provisioned concurrency at low traffic.
6. Keep every live cache change reproducible, drift-checkable, and reversible.

## Public API Cache Boundary

The general CloudFront `api/*` behavior remains on AWS managed `CachingDisabled`.
Narrow behaviors may cache only these paths:

- `GET /api/content/v3/bootstrap`
- `GET /api/content/v3/landing`
- `GET /api/content/v3/work`
- `GET /api/content/v3/projects/categories`
- `GET /api/content/v3/blog/:listItemId`
- `GET /api/content/v2/blog/cards`
- `GET /api/content/v2/blog/cards/media`

Everything else remains uncached, including health, preview sessions, admin/auth,
comments, subscriptions and confirmations, resume, analytics, upload, notifications,
social endpoints, MCP, legacy raw content reads, and every mutation.

The custom cache policies use:

- minimum TTL: `0`
- default TTL: `0`
- maximum TTL: `300`
- Brotli and gzip cache variants
- no cookies or viewer headers
- endpoint-specific query-string allowlists

Default TTL zero is intentional: if the origin omits an explicit shared-cache header,
CloudFront does not cache the response.

## Origin Cache Safety

The API applies public cache headers only to the allowlisted anonymous GET paths.
Before any response is sent:

- every `4xx` or `5xx` response is forced to `no-store, max-age=0, s-maxage=0`
- error responses also receive `Pragma: no-cache`, `Expires: 0`, and
  `Surrogate-Control: no-store`
- cacheable success responses remove `RateLimit-Limit`, `RateLimit-Policy`,
  `RateLimit-Remaining`, and `RateLimit-Reset`
- public blog cards force `published` and non-future visibility regardless of query input
- public blog payloads and search exclude private SEO tags
- card-media requests return images only for visible published, non-future posts
- the raw all-content route requires route-level authentication

These rules must deploy before the narrow CloudFront behaviors are enabled.

## Reproducible CloudFront Changes

Use the checked-in helper in dry-run mode first:

```bash
scripts/configure_cloudfront_public_api_cache.sh --dry-run
```

After backend cache-safety probes pass in production:

```bash
scripts/configure_cloudfront_public_api_cache.sh --apply
```

The script creates or updates four custom cache policies, preserves all unrelated
distribution configuration, writes a mode-600 rollback snapshot inside a mode-700
temporary directory, waits for deployment, and prints the exact rollback command.
It never prints origin custom-header values.

Use read-only drift validation after rollout:

```bash
scripts/configure_cloudfront_public_api_cache.sh --check
```

## Frontend Loading Strategy

- Landing waits for API content before considering remote fallback slides.
- Only the active hero image is mounted.
- Unsplash hero URLs expose 640/960/1280/1600 responsive candidates.
- The next slide is prefetched only after active-image load, a delay, and browser idle.
- Prefetch is disabled for save-data and 2G conditions.
- Secondary landing images are lazy, asynchronously decoded, and low priority.
- `/blog` and `/blog/:id` are separate lazy chunks, so the list does not download
  detail-only Markdown, carousel, auth, or comment code.
- PrimeNG imports are feature-scoped instead of exported wholesale from SharedModule.

## Lambda Cold Path

`portfolio-redis-api` remains Node.js 22, arm64, 1024 MB, and outside a VPC.
Provisioned concurrency is disabled.

Cold-path changes:

- the Redis package is not required when Redis is disabled
- Express route modules load on their first matching request
- scheduled publishing calls the existing service directly instead of re-entering
  API Gateway and Lambda through HTTP
- deployment runs tests before packaging and zips only runtime files
- the prior live alias target is captured and restored automatically when the
  post-alias public smoke test fails

The next larger step, only if live metrics justify it, is separate public-read,
admin/MCP/social, notification-worker, analytics-worker, and SNS handlers.

## Static Asset Policy

- hashed application assets remain immutable for one year
- `index.html` uses browser revalidation with a 60-second shared-edge window
- favicons use bounded browser and edge caching and are deployed with invalidation
- robots and sitemap use short bounded caching instead of immutable headers
- old hashed assets remain available during deployment rollback

## Verification Checklist

Before enabling edge caching:

- backend tests cover scheduled/future card-query attacks and arbitrary media IDs
- unknown blog detail returns `404` plus `no-store`
- forced public-route failures return `500` plus `no-store`
- raw all-content reads reject arbitrary bearer tokens
- cacheable successes contain no `RateLimit-*` headers

After enabling edge caching:

- first reviewed public GET is `Miss`, second is `Hit` with a positive `Age`
- allowed query strings create distinct cache entries
- unlisted query strings do not fragment the cache
- health, preview, comments, admin, auth, and writes stay uncached
- scheduled/future blog data remains unavailable
- the rollback snapshot and command are recorded in the Portfolio Notion task
