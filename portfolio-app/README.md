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
- Metadata-first rendering with additive `v2` APIs:
  - `GET /api/content/v2/page/:pageId`
  - `GET /api/content/v2/blog/cards`
  - `GET /api/content/v2/blog/cards/media`
  - `POST /api/content/v2/list-items/batch`
- Route-scoped browser caching + snapshot fallback for read paths.
- Progressive hydration:
  - blog cards render text/meta first
  - images hydrate in a separate media batch call.
- Preview overlay support using `previewToken` query param.
- Email subscription UX:
  - in-page subscribe form
  - first-visit popup
  - confirm/unsubscribe pages.
- SEO essentials:
  - route-level title/description
  - `robots.txt`
  - `sitemap.xml`.

## Runtime Contract

- Frontend never writes content directly.
- Content is read from `redis-api-server` (`/api/content*`).
- Source-of-truth content backend in production is DynamoDB (`CONTENT_BACKEND=dynamodb` in API runtime).

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
- Blog list streaming: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog.component.ts`
- Blog detail rendering: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.ts`

