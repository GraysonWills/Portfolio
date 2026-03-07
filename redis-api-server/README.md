# Portfolio API Service (`redis-api-server`)

Express backend for portfolio reads, authoring writes, notifications, subscriptions, analytics, and media services.

## Runtime Model

- Deploy target: AWS Lambda (`portfolio-redis-api`) behind API Gateway custom domain `api.grayson-wills.com`.
- Same app can also run as containerized ECS task (alternate workflow exists).
- Content backend:
  - **primary in production:** DynamoDB (`CONTENT_BACKEND=dynamodb`)
  - optional Redis compatibility mode (`CONTENT_BACKEND=redis`) for fallback/migration use.

## Main Capabilities

- Public read APIs + authenticated write APIs.
- Additive `v2` paged/metadata-first endpoints for progressive frontend hydration.
- Preview sessions for draft overlays (`previewToken` model).
- Queue-backed blog notification delivery (SQS -> Lambda worker -> SES).
- Subscription lifecycle (request/confirm/unsubscribe/preferences) in DynamoDB + SES.
- Analytics event ingestion endpoint with async queue/data-lake flow.
- Photo asset architecture:
  - S3 object storage
  - DynamoDB metadata/state
  - signed browser upload URLs.
- Public `/media/:key` S3 proxy for private-bucket delivery.

## Endpoint Inventory

Mounted in `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js`.

### Health
- `GET /api/health`
- `GET /api/health/liveness`
- `GET /api/health/readiness`

### Content (legacy + v2)
- `GET /api/content`
- `GET /api/content/:id`
- `GET /api/content/page/:pageId`
- `GET /api/content/page/:pageId/content/:contentId`
- `GET /api/content/list-item/:listItemId`
- `POST /api/content`
- `POST /api/content/batch`
- `PUT /api/content/:id`
- `DELETE /api/content/:id`
- `DELETE /api/content/list-item/:listItemId`
- `POST /api/content/preview/session`
- `GET /api/content/preview/:token`
- `GET /api/content/v2/page/:pageId`
- `GET /api/content/v2/blog/cards`
- `GET /api/content/v2/blog/cards/media`
- `POST /api/content/v2/list-items/batch`

### Notifications
- `POST /api/notifications/worker/publish` (scheduler secret)
- `GET /api/notifications/subscribers` (auth)
- `POST /api/notifications/subscribers` (auth)
- `DELETE /api/notifications/subscribers/:emailHash` (auth)
- `POST /api/notifications/send-now` (auth)
- `POST /api/notifications/schedule` (auth)
- `DELETE /api/notifications/schedule/:scheduleName` (auth)
- `POST /api/notifications/unpublish` (auth)

### Subscriptions
- `POST /api/subscriptions/request`
- `GET /api/subscriptions/confirm`
- `GET /api/subscriptions/unsubscribe`
- `POST /api/subscriptions/preferences`

### Analytics
- `POST /api/analytics/events`

### Media + Assets
- `POST /api/upload/image` (auth)
- `POST /api/photo-assets/upload-url` (auth)
- `POST /api/photo-assets/:assetId/complete` (auth)
- `GET /api/photo-assets` (auth)
- `GET /api/photo-assets/:assetId` (auth)
- `DELETE /api/photo-assets/:assetId` (auth)
- `GET /media/:key`

## Security Controls

- `helmet` hardening.
- origin allowlist CORS with apex/www normalization.
- API rate limits:
  - general `/api/*`
  - stricter write limiter
  - separate analytics limiter.
- write auth middleware via Cognito JWT validation.
- request body size limits (configurable via `REQUEST_BODY_LIMIT`, default `6mb`).
- in-process GET response cache with write invalidation.
- browser cache-control headers for GET responses.

## Environment Variables (Core)

### General

| Variable | Purpose |
|---|---|
| `PORT` | local server port |
| `NODE_ENV` | runtime mode |
| `ALLOWED_ORIGINS` | CORS allowlist |
| `CACHE_TTL_MS` | server in-memory GET cache TTL |
| `CACHE_MAX_ENTRIES` | server in-memory cache max entries |
| `REQUEST_BODY_LIMIT` | JSON/urlencoded max request payload (default `6mb`) |
| `BROWSER_CACHE_MAX_AGE_SECONDS` | browser `max-age` for GET responses |
| `BROWSER_CACHE_STALE_WHILE_REVALIDATE_SECONDS` | browser stale-while-revalidate seconds |

### Auth

| Variable | Purpose |
|---|---|
| `COGNITO_REGION` | Cognito region |
| `COGNITO_USER_POOL_ID` | pool id |
| `COGNITO_CLIENT_ID` | app client id |
| `DISABLE_AUTH` | local-only write-auth bypass |
| `SCHEDULER_WEBHOOK_SECRET` | protects internal scheduler callback route |
| `SCHEDULER_GROUP_NAME` | EventBridge Scheduler group (default `portfolio-email`) |
| `SCHEDULER_INVOKE_ROLE_ARN` | IAM role EventBridge Scheduler assumes to invoke Lambda |
| `SCHEDULER_TARGET_LAMBDA_ARN` | Lambda ARN used as schedule target |

### Content + Preview

| Variable | Purpose |
|---|---|
| `CONTENT_BACKEND` | `dynamodb` or `redis` |
| `CONTENT_TABLE_NAME` | DynamoDB content table |
| `PREVIEW_SESSIONS_TABLE_NAME` | DynamoDB preview sessions table |
| `PREVIEW_TTL_SECONDS` | preview token/session TTL |
| `PREVIEW_MAX_UPSERTS` | preview payload upsert cap |
| `PREVIEW_MAX_DELETES` | preview payload delete cap |
| `PREVIEW_MAX_BYTES` | preview payload size cap |

### Optional Redis Compatibility

| Variable | Purpose |
|---|---|
| `REDIS_HOST` | Redis endpoint |
| `REDIS_PORT` | Redis port |
| `REDIS_PASSWORD` | Redis password |
| `REDIS_TLS` | TLS on/off |
| `REDIS_DB` | DB index |

### Subscriptions + Email

| Variable | Purpose |
|---|---|
| `PUBLIC_SITE_URL` | URL used in email links |
| `SES_FROM_EMAIL` | SES sender |
| `SUBSCRIBERS_TABLE_NAME` | subscriber table name |
| `TOKENS_TABLE_NAME` | action token table name |
| `SUBSCRIBE_ALLOWED_TOPICS` | comma-separated topics |
| `EMAIL_BRAND_LOGO_URL` | optional logo URL in email templates |

### Notification Queue

| Variable | Purpose |
|---|---|
| `NOTIFICATION_QUEUE_ENABLED` | toggle queue-backed sends |
| `NOTIFICATION_QUEUE_URL` | SQS queue URL |

### Analytics Queue/Data Lake

| Variable | Purpose |
|---|---|
| `ANALYTICS_QUEUE_ENABLED` | analytics queue enable |
| `ANALYTICS_QUEUE_URL` | analytics SQS queue URL |
| `ANALYTICS_S3_BUCKET` | analytics landing bucket |
| `ANALYTICS_S3_PREFIX` | analytics key prefix |
| `ANALYTICS_S3_REGION` | analytics bucket region |
| `ANALYTICS_DEFAULT_SOURCE` | event source label |
| `ANALYTICS_IP_HASH_SALT` | optional hash salt |

### Photo Assets

| Variable | Purpose |
|---|---|
| `PHOTO_ASSETS_TABLE_NAME` | metadata table |
| `PHOTO_ASSETS_BUCKET` | object bucket |
| `PHOTO_ASSETS_REGION` | bucket region |
| `PHOTO_ASSETS_PREFIX` | key prefix |
| `PHOTO_ASSETS_PRESIGN_EXPIRES_SECONDS` | upload URL TTL |
| `PHOTO_ASSETS_MAX_FILE_BYTES` | max upload size |
| `PHOTO_ASSETS_ALLOWED_MIME` | allowed MIME list |
| `PHOTO_ASSETS_CDN_BASE_URL` | optional CDN base override |

## Local Development

```bash
cd /Users/grayson/Desktop/Portfolio/redis-api-server
npm ci
npm run dev
```

Default local URL: `http://localhost:3000`

Health check:

```bash
curl -s http://localhost:3000/api/health | jq
```

## Tests

```bash
cd /Users/grayson/Desktop/Portfolio/redis-api-server
npm test
```

Includes node test runner coverage for:
- pagination token behavior
- `v2` content route logic.

## Deployment Automation

- Lambda workflow: `/Users/grayson/Desktop/Portfolio/.github/workflows/api-deploy.yml`
- ECS workflow: `/Users/grayson/Desktop/Portfolio/.github/workflows/ecs-deploy.yml`

## Required Post-Deploy Verification (Lambda <-> SES)

After any deploy/config change affecting subscriptions, notifications, or email templates:

1. Check Lambda env values:
   - `SES_FROM_EMAIL`
   - `SES_REGION`
   - `PUBLIC_SITE_URL`
   - `EMAIL_BRAND_LOGO_URL`
2. Verify sender identity/domain in SES in the same region.
3. Review CloudWatch log patterns in the deployment window:
   - `"[subscriptions] SES send failed"`
   - `"[subscriptions] Subscribed email failed"`
4. Perform one end-to-end subscription confirm flow and verify:
   - API returns `SUBSCRIBED` on confirm
   - no SES failure logs
   - subscriber state in `portfolio-email-subscribers` is `SUBSCRIBED`

Suggested command snippets:

```bash
AWS_PROFILE=grayson-sso AWS_REGION=us-east-2 \
aws lambda get-function-configuration \
  --function-name portfolio-redis-api \
  --query 'Environment.Variables.{SES_FROM_EMAIL:SES_FROM_EMAIL,SES_REGION:SES_REGION,PUBLIC_SITE_URL:PUBLIC_SITE_URL,EMAIL_BRAND_LOGO_URL:EMAIL_BRAND_LOGO_URL}'

AWS_PROFILE=grayson-sso AWS_REGION=us-east-2 \
aws logs filter-log-events \
  --log-group-name /aws/lambda/portfolio-redis-api \
  --start-time $((($(date +%s)-3600)*1000)) \
  --filter-pattern '"[subscriptions] SES send failed"'
```

Health endpoint now surfaces email/scheduler config status under:
- `GET /api/health` -> `integrations.*` and `integrations.issues[]`

## Reference Docs

- Root project overview: `/Users/grayson/Desktop/Portfolio/README.md`
- `v2` content contract: `/Users/grayson/Desktop/Portfolio/docs/content-v2-streaming.md`
- comprehensive architecture pack: `/Users/grayson/Desktop/Portfolio/docs/comprehensive/README.md`
