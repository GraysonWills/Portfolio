# 04 - Code Deep Dive

This document provides code-level detail for all three main applications.

## 1. Public Site (`portfolio-app`)

## 1.1 Responsibilities
- Serve public personal portfolio pages.
- Read content from backend APIs.
- Render blog list/post pages and notification confirmation routes.
- Track frontend analytics events.
- Reuse only route-scoped in-memory reads during the current SPA session.
- Render metadata before non-critical media and append list/timeline content progressively.

## 1.2 Routing
File: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/app-routing.module.ts`

Primary routes:
- `/`
- `/work`
- `/projects`
- `/blog`
- `/notifications`

## 1.3 Key services
- `redis.service.ts`: fetches content and transforms API payloads for views.
- `linkedin-data.service.ts`: resolves profile/work/project data shaping.
- SEO/meta service classes in app layer for title/description updates.
- `analytics.service.ts`: sends frontend telemetry batches to `/api/analytics/events`.

## 1.4 Data assumptions
- UI is driven by `PageID` and `PageContentID`.
- Blog rendering groups content records by `ListItemID`.
- Blog metadata is expected in `PageContentID=3` (`BlogItem`).
- Blog feed/media lists use metadata-first `v2` reads + batch media hydration.
- Landing, work, projects, and blog detail prefer `v3` route-shaped payloads.

## 2. Authoring Console (`blog-authoring-gui`)

## 2.1 Responsibilities
- Authenticated authoring and administration UI.
- Blog create/edit/delete, preview, schedule, publish.
- Blog unpublish and send-now notification controls.
- Site content editing and image upload.
- Subscriber management.
- Collections management (authoring-only content categories and visibility).
- Human-friendly section-based editing over the same backend record model.

## 2.2 Routing
File: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app-routing.module.ts`

Routes:
- `/login`
- `/register`
- `/forgot-password`
- `/dashboard`
- `/content`
- `/subscribers`
- `/collections`

## 2.3 Auth and session model
File: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts`

Highlights:
- Cognito User Pool login and token persistence.
- device persistence through localStorage session payload.
- refresh token support.
- login throttle policy:
  - max attempts: 5
  - window: 5 minutes.

## 2.4 Hotkey model
Files:
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/hotkeys.service.ts`
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app.component.ts`

Highlights:
- global + page-scoped registrations.
- context switching by route.
- hotkey help dialog with active bindings.

## 2.5 Collections model
Files:
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/pages/collections/collections.component.ts`
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts`

Highlights:
- category registry persisted as `PageID=4`, `PageContentID=16`.
- entries persisted as `PageID=4`, `PageContentID=17`.
- visibility flags for staged release (`hidden`/`public`) without immediate public rendering.
- import local text files into entry body.

## 2.6 Service API client
File: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts`

Core areas:
- generic content CRUD.
- blog lifecycle APIs.
- save path keeps `BlogBody` and `BlogText` aligned for existing and new posts.
- notification subscriber admin APIs.
- unpublish API integration.
- preview token session APIs.
- photo-asset signed upload lifecycle.
- collections registry and entry APIs.
- route-scoped in-memory read reuse and `v2`/`v3` fallback behavior.
- inline editor image normalization for embedded `data:image/*` markup.

## 3. Backend API (`redis-api-server`)

## 3.1 App composition
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js`

Composition details:
- middleware stack (helmet, cors, compression, morgan, rate-limit, body parsers).
- dynamic GET responses marked `Cache-Control: no-store`.
- configurable request body limit (`REQUEST_BODY_LIMIT`, default `6mb`).
- route mounting for all API groups.

## 3.2 Route inventory

### Content
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/content.js`
- `GET /api/content`
- `GET /api/content/:id`
- `GET /api/content/page/:pageId`
- `GET /api/content/page/:pageId/content/:contentId`
- `GET /api/content/list-item/:listItemId`
- `GET /api/content/v2/page/:pageId`
- `GET /api/content/v2/blog/cards`
- `GET /api/content/v2/blog/cards/media`
- `POST /api/content/v2/list-items/batch`
- `GET /api/content/v3/bootstrap`
- `GET /api/content/v3/landing`
- `GET /api/content/v3/work`
- `GET /api/content/v3/projects/categories`
- `POST /api/content/v3/projects/items`
- `GET /api/content/v3/blog/:listItemId`
- `GET /api/content/v3/admin/dashboard`
- `GET /api/content/v3/admin/content`
- `POST /api/content`
- `POST /api/content/batch`
- `PUT /api/content/:id`
- `DELETE /api/content/:id`
- `DELETE /api/content/list-item/:listItemId`
- preview session:
  - `POST /api/content/preview/session`
  - `GET /api/content/preview/:token`

### Notifications
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/notifications.js`
- `POST /api/notifications/worker/publish`
- `GET /api/notifications/subscribers`
- `POST /api/notifications/subscribers`
- `DELETE /api/notifications/subscribers/:emailHash`
- `POST /api/notifications/send-now`
- `POST /api/notifications/schedule`
- `DELETE /api/notifications/schedule/:scheduleName`
- `POST /api/notifications/unpublish`

### Subscriptions
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/subscriptions.js`
- `POST /api/subscriptions/request`
- `GET /api/subscriptions/confirm`
- `GET /api/subscriptions/unsubscribe`
- `POST /api/subscriptions/preferences`

### Analytics
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/analytics.js`
- `POST /api/analytics/events`

### Photo assets
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/photo-assets.js`
- `POST /api/photo-assets/upload-url`
- `POST /api/photo-assets/:assetId/complete`
- `GET /api/photo-assets`
- `GET /api/photo-assets/:assetId`
- `DELETE /api/photo-assets/:assetId`

### Other
- upload: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/upload.js`
- health: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/health.js`
- media proxy: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/media.js`
- admin: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/admin.js`

## 3.3 Service behavior notes

### Notifications engine
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/notifications.js`
- supports queue-backed send path (preferred).
- supports schedule creation and cancellation.
- writes metadata back into content to track schedule/send state.
- includes send-marker logic for idempotency.
- ignores stale/non-active scheduled publish executions using schedule-name checks.
- supports unpublish cleanup of active + stale schedules.
- supports subscriber admin list/add/remove through notifications route surface.

### Subscriptions engine
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/subscriptions.js`
- request/confirm/unsubscribe token workflow.
- DynamoDB-backed status transitions.
- SES confirmation/subscribed/unsubscribed email templates.

### Analytics engine
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/analytics.js`
- normalizes and bounds event payloads.
- SQS batch enqueue.
- Lambda SQS consumer writes partitioned gzip NDJSON to S3.

### Photo assets engine
File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/photo-assets-ddb.js`
- pending-to-ready asset lifecycle.
- owner and recency queries via GSIs.
- metadata and status tracking separate from object binary.
- frontend upload path uses signed URL -> direct S3 upload -> explicit completion callback.

## 4. Lambda Event Multiplexing

File: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/lambda.js`

A single handler supports:
- API Gateway HTTP events.
- SQS events:
  - blog notification queue records.
  - analytics queue records.
- SNS feedback events:
  - bounce and complaint updates.
- internal scheduled publish invocations.

## 5. CI/CD and Quality Automation

### Workflows
- `/Users/grayson/Desktop/Portfolio/.github/workflows/ci-cd.yml`
- `/Users/grayson/Desktop/Portfolio/.github/workflows/api-deploy.yml`
- `/Users/grayson/Desktop/Portfolio/.github/workflows/security.yml`
- `/Users/grayson/Desktop/Portfolio/.github/workflows/senior-review.yml`

### Quality gates in workflows
- frontend and backend build + test.
- security scanning (gitleaks, codeql, npm audit).
- AI-assisted senior review report generation.
- production deployment with CloudFront invalidation.

## 6. Extension Checklist (Code-Oriented)

When adding new content domains:
1. define `PageID` and `PageContentID` contract in shared models.
2. add authoring UI editor form and metadata validation.
3. add API client methods in `blog-api.service.ts`.
4. if public-facing, add portfolio route + renderer.
5. add docs entry in this pack and README table.

When adding new AWS services:
1. add env variables in API README and root README.
2. add workflow support if deployment automation is required.
3. add route/service implementation with explicit rate limits.
4. add health visibility and operational logs.
