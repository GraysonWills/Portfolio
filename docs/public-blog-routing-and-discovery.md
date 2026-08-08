# Public Blog Routing and Discovery

Last updated: 2026-08-08

How a public blog URL becomes a rendered post, and how crawlers discover the
site. Written after fixing two outages where `portfolio-app` shipped against API
endpoints that were never implemented.

## Why this document exists

`portfolio-app` and `redis-api-server` deploy from the same repo but through two
independent workflows (`ci-cd.yml`, `api-deploy.yml`), and nothing tests the
contract between them. A frontend can therefore ship a call to an endpoint that
does not exist, both pipelines stay green, and the failure only appears in
production. That happened twice:

| Shipped | Called | Implemented | Result |
| --- | --- | --- | --- |
| `00529c4` (2026-07-21) | `GET /content/v3/blog/resolve/:value` | never | every blog post URL was HTTP 404 for 18 days |
| `00529c4` (2026-07-21) | `GET /api/discovery/*` (5 paths) | never | `/rss.xml`, `/feed.json`, `/llms.txt` returned 404 JSON |

Both were fixed on 2026-08-08 (`a60854e`, `9d16b55`).

The blog one was expensive because the failure was not cosmetic. SSR maps a
failed resolve onto the page response, so each post URL returned a real `404`
carrying `x-robots-tag: noindex, nofollow, noarchive` — instructing search
engines to drop the entire blog — and every link the publishing pipeline posted
to social in that window pointed at a dead page.

**If you add a call from `portfolio-app` to the API, verify the route exists in
`redis-api-server/src/routes/` in the same change.** A green build does not mean
the endpoint is there.

## Request path for `/blog/<slug>`

1. CloudFront routes the request to the SSR Lambda (static asset patterns and
   `sitemap.xml` / `robots.txt` go to the S3 origin instead — see
   `scripts/setup_portfolio_ssr.sh`).
2. `portfolio-app/server.ts` matches `/blog/:value` and calls
   `GET /api/content/v3/blog/resolve/:value`.
   - Non-200 becomes the page status. This is why a missing endpoint produces a
     hard 404 plus `noindex` headers rather than a soft error page.
3. On 200, Angular renders and the client loads the post body with
   `GET /api/content/v3/blog/:listItemId`.

### `GET /api/content/v3/blog/resolve/:value`

Defined in `redis-api-server/src/routes/content.js`, immediately before
`/v3/blog/:listItemId`.

Accepts either form, because permalinks minted before slugs existed used the raw id:

- a slug — `my-reward-is-in-the-work` → `routeKind: "canonical"`
- a `listItemID` — `mesh-01kyj3...` → `routeKind: "legacy-id"`

```json
{
  "listItemID": "mesh-01kyj3jhmwan0nq9z5gvyx73wy",
  "slug": "my-reward-is-in-the-work",
  "canonicalPath": "/blog/my-reward-is-in-the-work",
  "redirect": false,
  "routeKind": "canonical",
  "dateModified": "2026-08-07T12:00:37.613Z"
}
```

`redirect` is true only when the requested path differs from `canonicalPath`, so
a canonical hit never triggers a pointless client redirect.

Visibility reuses `buildBlogCardsFromPageItems` + `filterBlogCards` from
`services/content-v2.js` — the same helpers behind the public cards feed — so
drafts, scheduled, and future-dated posts 404 here exactly as they are excluded
there. Resolve must never become a side door around publishing.

## Slugs

Derivation lives in **one** place: `src/utils/blog-slug.js`.

It is shared deliberately. The write path (`services/blog-posts.js`) persists
`metadata.slug` and stamps `plannedUrl = <site>/blog/<slug>` into
`socialAutomation.postUrl`, which is the URL posted to LinkedIn and Instagram.
The read path resolves that same slug back to a post. **If the two derivations
ever drift, already-published permalinks stop resolving** — including links
already out in the world. Do not inline a second slugify.

Resolution order when reading: stored `metadata.slug` first, then a slug derived
from the title (posts predating slug persistence have none stored).

### `listItemID` prefixes

Three schemes exist historically, and all still resolve:

| Shape | Origin |
| --- | --- |
| `blog-<ms>` | oldest studio-created posts |
| `<slug>-<base36>-<hex>` | `generateListItemID()`, current API default |
| `mesh-<ulid>` | mesh pipeline, `workers/publisher/handler.py` |

`buildRecordsFromInput` honours a caller-supplied `input.listItemID` and only
generates one when it is absent, which is why mesh posts keep their own ids.
This is cosmetic — resolution works by slug regardless of id shape.

## Discovery feeds

`server.ts` maps five public paths onto `redis-api-server/src/routes/discovery.js`:

| Public path | Endpoint | Served from |
| --- | --- | --- |
| `/sitemap.xml` | `/api/discovery/sitemap.xml` | **S3 static** (CloudFront behavior) |
| `/robots.txt` | `/api/discovery/robots.txt` | **S3 static** (CloudFront behavior) |
| `/rss.xml` | `/api/discovery/rss.xml` | SSR → API |
| `/feed.json` | `/api/discovery/feed.json` | SSR → API |
| `/llms.txt` | `/api/discovery/llms.txt` | SSR → API |

These are generated, not checked in, because posts publish on their own schedule
with no site rebuild to regenerate a static file.

### The sitemap indirection

`sitemap.xml` and `robots.txt` are pinned to the S3 origin by
`scripts/setup_portfolio_ssr.sh` (`c4a3530`), so they never reach the SSR
Lambda and a static sitemap could never list a post. Rather than move the path
off S3, `portfolio-app/public/sitemap.xml` is a **sitemap index** pointing at
`/api/discovery/sitemap.xml`, and `public/robots.txt` grants the
content-reading crawlers `Allow: /api/discovery/` so they can fetch it.

Changing this to serve `/sitemap.xml` dynamically means dropping `sitemap.xml`
from the S3 cache behaviors in that script and re-running it against the
distribution.

Feeds carry `Cache-Control: public, max-age=300, s-maxage=900,
stale-while-revalidate=3600` — enough to keep a crawl burst off DynamoDB without
leaving a new post unlisted for long. All titles and summaries are XML-escaped;
an unescaped `&` alone invalidates the whole feed.

## Reads

`services/content-source.js` owns the redis-primary / DynamoDB-fallback policy
for content reads, shared by the content routes and the discovery feeds. It was
extracted from `routes/content.js` so there is one copy of that policy rather
than two that can diverge.

Blog reads go through `readContentByPageAndContent(3, 3)` — `PageContentID 3` is
the single metadata record per post — which uses the `PageIndex` GSI and reads
about one row per post instead of scanning the table.

## Test coverage

- `test/public-content-cache-safety.test.js` — resolve by slug and by legacy id,
  plus draft/scheduled/future/unknown all 404.
- `test/discovery.test.js` — all five feeds, XML escaping, newest-first
  ordering, and hidden posts excluded from every crawlable index.

Before this work the only v3 blog test hit the single-segment
`/api/content/v3/blog/missing`, which is precisely why an entirely missing
route went unnoticed for 18 days.

## Verifying in production

```bash
curl -sI https://www.grayson-wills.com/blog/<slug> | head -1   # expect 200, no x-robots-tag
curl -s  https://www.grayson-wills.com/api/discovery/sitemap.xml | grep -c '<loc>'
```
