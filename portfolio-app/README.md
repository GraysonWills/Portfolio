# Portfolio App (`portfolio-app`)

Public Angular frontend for `https://www.grayson-wills.com`.

## What Is Implemented

- Routes:
  - `/`
  - `/work`
  - `/projects`
  - `/blog`
  - `/blog/:id`
  - `/notifications/*`
- Metadata-first rendering with additive `v2` and route-shaped `v3` APIs:
  - `GET /api/content/v3/bootstrap`
  - `GET /api/content/v3/landing`
  - `GET /api/content/v3/work`
  - `GET /api/content/v3/projects/categories`
  - `POST /api/content/v3/projects/items`
  - `GET /api/content/v3/blog/:listItemId`
  - `GET /api/content/v2/blog/cards`
  - `GET /api/content/v2/blog/cards/media`
- Route-scoped in-memory request reuse only for active SPA sessions.
- Dynamic content snapshots are not persisted in browser storage.
- Progressive hydration:
  - landing loads shell + summary + hero slide metadata from `v3/landing`
  - blog cards render text/meta first and hydrate images in a separate media batch call
  - work timeline loads in paged chunks from `v3/work`
  - project categories load first and hydrate category items lazily
- Explicit incremental loading UX:
  - `Load More Posts` on blog
  - `Load More Categories` on projects
- Preview overlay support using `previewToken` query param.
- Email subscription UX:
  - in-page subscribe form
  - blog-engagement modal (suppressed for 60 days after first dismissal, disabled after second dismissal)
  - confirm/unsubscribe pages.
- Session-scoped route view state memory:
  - restores scroll position immediately on route re-entry
  - applies a short post-hydration correction pass for landing, work, projects, and blog
  - preserves hero slide, project accordion state, work timeline depth, and blog page/layout/search state
- SEO essentials:
  - route-level title/description
  - `robots.txt`
  - `sitemap.xml`.

## Runtime Contract

- Frontend never writes content directly.
- Content is read from `redis-api-server` (`/api/content*`).
- Source-of-truth content backend in production is DynamoDB (`CONTENT_BACKEND=dynamodb` in API runtime).
- Blog feed cards use metadata-first `v2` card endpoints.
- Landing, work, projects, and blog detail routes prefer `v3` read models.

## Environment Flags

File: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/environments/environment*.ts`

```ts
redisApiUrl: 'https://api.grayson-wills.com/api' // prod
useContentV2Stream: true
useBlogV2Cards: true
```

Notes:
- `mailchimp*` fields still exist in environment files for backward compatibility.
- Current subscription flow is AWS API/SES-based, not Mailchimp-driven.

## Analytics + Metrics

- Frontend analytics batches page and interaction events to `POST /api/analytics/events`.
- Analytics is now consent-gated on the public site.
- Cookie banner flow is managed in `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/app.component.ts`.
- Consent state is stored in the strictly necessary `gw_consent` cookie.
- When analytics is accepted, the frontend sets first-party cookies:
  - `gw_vid`: anonymous persistent visitor state
  - `gw_sid`: rolling 30-minute session state
  - `gw_attr`: first-touch attribution (`utm_*`, landing route, first referrer domain)
- Anonymous visitor/session continuity is no longer stored in `localStorage` / `sessionStorage` for analytics identity.
- Every analytics event now carries consent and attribution metadata:
  - `consent.analytics`
  - `visitorKind`
  - `sessionIndex`
  - `utmSource`
  - `utmMedium`
  - `utmCampaign`
  - `landingRoute`
  - `referrerDomain`
- Route interactions tracked in the app include:
  - page views
  - CTA clicks
  - blog card render + image hydration milestones
  - subscribe-flow events and outcomes

## Local Development

Prerequisites:
- Node.js 22.x
- npm 10+
- Angular CLI 19+
- running API server (`/Users/grayson/Desktop/Portfolio/redis-api-server`)

Run:

```bash
cd /Users/grayson/Desktop/Portfolio/portfolio-app
npm ci
npm start -- --port 4300
```

Open: `http://localhost:4300`

## Build + Test

```bash
cd /Users/grayson/Desktop/Portfolio/portfolio-app
npm test -- --watch=false --browsers=ChromeHeadless --no-progress
npm run build -- --configuration=production
```

## Deployment

Deployment is automated by:
- `/Users/grayson/Desktop/Portfolio/.github/workflows/ci-cd.yml`

Production target:
- S3 bucket: `www.grayson-wills.com`
- CloudFront distribution: `E28CZKZOGGZGVK`

## Key Files

- Routing: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/app-routing.module.ts`
- Data client: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/redis.service.ts`
- Analytics client: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/analytics.service.ts`
- Consent + cookie state: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/site-consent.service.ts`
- Blog list streaming: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog.component.ts`
- Blog detail rendering: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.ts`
- Work timeline paging: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/work/work.component.ts`
- Projects category paging + hydration: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/projects/projects.component.ts`
