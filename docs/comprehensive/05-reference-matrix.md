# 05 - Reference Matrix

Quick reference for architecture, runtime, and implementation links.

## 1. Application Surfaces

| Surface | URL | Codebase |
|---|---|---|
| Public portfolio | `https://www.grayson-wills.com` | `/Users/grayson/Desktop/Portfolio/portfolio-app` |
| Apex redirect | `https://grayson-wills.com` -> `https://www.grayson-wills.com` | edge config |
| Blog authoring dev | `https://d39s45clv1oor3.cloudfront.net` | `/Users/grayson/Desktop/Portfolio/blog-authoring-gui` |
| API base | `https://api.grayson-wills.com/api` | `/Users/grayson/Desktop/Portfolio/redis-api-server` |

## 2. Shared Content IDs

| PageID | Meaning |
|---|---|
| 0 | Landing |
| 1 | Work |
| 2 | Projects |
| 3 | Blog |
| 4 | Collections (authoring only) |

| PageContentID | Meaning |
|---|---|
| 0 | HeaderText |
| 1 | HeaderIcon |
| 2 | FooterIcon |
| 3 | BlogItem |
| 4 | BlogText |
| 5 | BlogImage |
| 6 | LandingPhoto |
| 7 | LandingText |
| 8 | WorkText |
| 9 | ProjectsCategoryPhoto |
| 10 | ProjectsCategoryText |
| 11 | ProjectsPhoto |
| 12 | ProjectsText |
| 13 | BlogBody |
| 14 | WorkSkillMetric |
| 15 | BlogSignatureSettings |
| 16 | CollectionsCategoryRegistry |
| 17 | CollectionsEntry |

## 3. DynamoDB Tables

| Table | Purpose | Primary usage |
|---|---|---|
| `portfolio-content` | content records | all site/page/blog/collections data |
| `portfolio-content-preview-sessions` | draft previews | authoring preview token payloads |
| `portfolio-email-subscribers` | subscription state | subscriber status and topics |
| `portfolio-email-tokens` | one-time tokens | confirm/unsubscribe/manage token validation |
| `portfolio-photo-assets` | photo metadata | signed upload lifecycle and asset catalog |

## 4. Queue and Async Components

| Component | Purpose |
|---|---|
| SQS notification queue | decouple blog publish email sends |
| EventBridge Scheduler | delayed publish/send jobs |
| SQS analytics queue | decouple frontend telemetry ingestion |
| Lambda SQS consumers | process queued email + analytics records |
| SNS feedback handling | bounce/complaint updates back to subscriber state |

## 5. GitHub Workflow Map

| Workflow | File |
|---|---|
| Portfolio/site CI/CD | `/Users/grayson/Desktop/Portfolio/.github/workflows/ci-cd.yml` |
| API Lambda deploy | `/Users/grayson/Desktop/Portfolio/.github/workflows/api-deploy.yml` |
| Security scans | `/Users/grayson/Desktop/Portfolio/.github/workflows/security.yml` |
| Senior engineer review automation | `/Users/grayson/Desktop/Portfolio/.github/workflows/senior-review.yml` |

## 6. Core Service Entry Points

| Responsibility | File |
|---|---|
| Express app factory | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js` |
| Lambda event multiplexer | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/lambda.js` |
| Content data access | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/content-ddb.js` |
| Notifications orchestration | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/notifications.js` |
| Subscription lifecycle | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/subscriptions.js` |
| Analytics ingestion | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/analytics.js` |
| Photo asset metadata | `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/photo-assets-ddb.js` |
| Authoring API client | `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts` |
| Authoring auth/session | `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts` |
| Authoring hotkeys | `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/hotkeys.service.ts` |
| Content Studio workspace | `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/pages/content-studio/content-studio.component.ts` |
| Public read client | `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/redis.service.ts` |
| Public analytics client | `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/analytics.service.ts` |

## 7. Streaming + Cache Flags

| Setting | Location | Current |
|---|---|---|
| `useContentV2Stream` | both frontend `environment*.ts` files | `true` |
| `useBlogV2Cards` | both frontend `environment*.ts` files | `true` |
| client route-scoped in-memory reuse | `redis.service.ts`, `blog-api.service.ts` | enabled |
| browser snapshot cache | frontend apps | disabled |
| server in-memory GET cache | `redis-api-server/src/app.js` | removed |
| dynamic GET cache headers | `redis-api-server/src/app.js` | `no-store` |

## 8. Key Route Contracts

| Area | Contract |
|---|---|
| Public shell/bootstrap | `GET /api/content/v3/bootstrap` |
| Landing | `GET /api/content/v3/landing` |
| Work | `GET /api/content/v3/work` |
| Projects categories | `GET /api/content/v3/projects/categories` |
| Projects item hydration | `POST /api/content/v3/projects/items` |
| Blog feed cards | `GET /api/content/v2/blog/cards` |
| Blog feed media hydration | `GET /api/content/v2/blog/cards/media` |
| Blog detail | `GET /api/content/v3/blog/:listItemId` |
| Authoring dashboard | `GET /api/content/v3/admin/dashboard` |
| Authoring Content Studio | `GET /api/content/v3/admin/content` |
| Unpublish action | `POST /api/notifications/unpublish` |
