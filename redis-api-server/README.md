# Portfolio API Service (`redis-api-server`)

Express backend for portfolio reads, authoring writes, notifications, subscriptions, analytics, and media services.

## Runtime Model

- Deploy target: AWS Lambda (`portfolio-redis-api`) behind API Gateway custom domain `api.grayson-wills.com`.
- Content backend:
  - **primary in production:** DynamoDB (`CONTENT_BACKEND=dynamodb`)
  - optional Redis compatibility mode (`CONTENT_BACKEND=redis`) for fallback/migration use.

## Main Capabilities

- Public read APIs + authenticated write APIs.
- Additive `v2` paged/metadata-first endpoints for progressive frontend hydration.
- Additive `v3` route-shaped endpoints for no-cache page rendering and authoring feeds.
- Preview sessions for draft overlays (`previewToken` model).
- Queue-backed blog notification delivery (SQS -> Lambda worker -> SES).
- Scheduler hardening for publish flow:
  - schedule payloads carry `scheduleName`
  - worker ignores stale/non-active schedule executions
  - stale schedule cleanup is performed during reschedule/unpublish paths
- Subscription lifecycle (request/confirm/unsubscribe/preferences) in DynamoDB + SES.
  - subscriber uniqueness is enforced by normalized `emailHash`
  - subscribe requests use an atomic conditional write so repeated/concurrent requests do not trigger duplicate confirmation emails
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
- `GET /api/content/v3/bootstrap`
- `GET /api/content/v3/landing`
- `GET /api/content/v3/work`
- `GET /api/content/v3/projects/categories`
- `POST /api/content/v3/projects/items`
- `GET /api/content/v3/blog/:listItemId`
- `GET /api/content/v3/admin/dashboard` (auth)
- `GET /api/content/v3/admin/content` (auth)

### Notifications
- `POST /api/notifications/worker/publish` (scheduler secret)
- `GET /api/notifications/subscribers` (auth)
- `POST /api/notifications/subscribers` (auth)
- `DELETE /api/notifications/subscribers/:emailHash` (auth)
- `POST /api/notifications/send-now` (auth)
- `POST /api/notifications/schedule` (auth)
- `DELETE /api/notifications/schedule/:scheduleName` (auth)
- `POST /api/notifications/unpublish` (auth)

### Social Auth
- `GET /api/social-auth/status` (auth)
- `POST /api/social-auth/:provider/start` (auth)
- `GET /api/social-auth/:provider/accounts` (auth)
- `POST /api/social-auth/:provider/accounts/select` (auth)
- `DELETE /api/social-auth/:provider` (auth)
- `GET /api/social-auth/:provider/callback`
- `GET /api/social-distribution/settings` (auth)
- `PUT /api/social-distribution/settings` (auth)
- `GET /api/social-distribution/deliveries` (auth)
- `POST /api/social-distribution/deliveries/:deliveryId/send` (auth)
- `DELETE /api/social-distribution/deliveries/:deliveryId` (auth)

Initial provider IDs:
- `x`
- `linkedin`
- `facebook`
- `instagram`

The callback URLs to register with each provider app are:
- `https://api.grayson-wills.com/api/social-auth/x/callback`
- `https://api.grayson-wills.com/api/social-auth/linkedin/callback`
- `https://api.grayson-wills.com/api/social-auth/facebook/callback`
- `https://api.grayson-wills.com/api/social-auth/instagram/callback`

Operational flow:
1. Provider app credentials are configured once on Lambda.
2. The authoring Distribution tab calls `POST /api/social-auth/:provider/start` when Connect is pressed.
3. The backend creates a 10-minute state record, builds the provider OAuth URL, and returns it to the browser.
4. The provider redirects back to `/api/social-auth/:provider/callback` with an authorization code.
5. The backend exchanges that code for token artifacts, encrypts the raw token payload, stores it in DynamoDB, and redirects back to the authoring Distribution tab.
6. X and LinkedIn personal posting identities are selected automatically when profile lookup succeeds.
7. Facebook and Instagram require account selection after OAuth; the authoring Distribution tab calls the account list/select endpoints to choose a Facebook Page or page-linked Instagram account.
8. `GET /api/social-auth/status` returns non-sensitive connection metadata such as scopes, expiry, selected account label, and which credential artifacts were captured.
9. Blog publish/schedule events create social delivery records from saved templates/rules. Zero-delay deliveries send inline, delayed deliveries use the existing EventBridge Scheduler target, and review-required deliveries stay in `needs_review`.

Unpublish behavior:
- cancels known active schedule for the post (if present)
- removes stale schedules for the same `listItemID`
- removes unsent social distribution deliveries for the same `listItemID`
- sets metadata status to `draft` and clears active `scheduleName`

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
- dynamic API GET responses are marked `Cache-Control: no-store, max-age=0`.
- in-flight request reuse happens in the frontend only for the current SPA session.

## Performance Architecture

- Public route reads are metadata-first and route-specific.
- Normal authoring reads no longer depend on `/api/health`.
- `v3/admin/content` avoids full-table scans in the normal path by using:
  - page+content targeted queries
  - page-scoped queries
  - bounded fanout across known pages for “all pages”
- New writes stamp derived read-model fields:
  - `PagePK`, `PageSK`
  - `UpdatedPK`, `UpdatedSK`
  - `FeedPK`, `FeedSK`
- These fields prepare the table for future GSI-backed render feeds without changing content payload shape again.

## Environment Variables (Core)

### General

| Variable | Purpose |
|---|---|
| `PORT` | local server port |
| `NODE_ENV` | runtime mode |
| `ALLOWED_ORIGINS` | CORS allowlist |
| `REQUEST_BODY_LIMIT` | JSON/urlencoded max request payload (default `6mb`) |

### Auth

| Variable | Purpose |
|---|---|
| `COGNITO_REGION` | Cognito region |
| `COGNITO_USER_POOL_ID` | pool id |
| `COGNITO_CLIENT_ID` | app client id |
| `DISABLE_AUTH` | local-only write-auth bypass |
| `COMMENTS_COGNITO_REGION` | optional public-comment Cognito region override |
| `COMMENTS_COGNITO_USER_POOL_ID` | optional public-comment user pool override |
| `COMMENTS_COGNITO_CLIENT_ID` / `COMMENTS_COGNITO_CLIENT_IDS` | optional public-comment app client(s); falls back to `COGNITO_CLIENT_ID` |
| `COMMENTS_REQUIRE_VERIFIED_EMAIL` | require `email_verified` on commenter ID tokens (default true) |
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

### Blog Comments

| Variable | Purpose |
|---|---|
| `COMMENTS_TABLE_NAME` | DynamoDB comments table (default `portfolio-blog-comments`) |
| `COMMENTS_POST_INDEX_NAME` | comments table GSI for `postId` reads (default `PostIndex`) |
| `COMMENTS_AUTHOR_DISPLAY_NAME` | display name used by authoring-studio replies |

Recommended comments table shape:
- Primary key: `commentId` (string)
- GSI `PostIndex`: partition key `postId` (string), sort key `sortKey` (string)
- Billing: on-demand is sufficient for current traffic expectations

Production resources:
- Cognito user pool: `GraysonPortfolioReaders` (`us-east-2_TA0sz2HlV`)
- Cognito app client: `portfolio-comments-spa` (`4gdttn5rjq3k3jd47jltik9trd`)
- DynamoDB comments table: `portfolio-blog-comments`

### Social Distribution OAuth

| Variable | Purpose |
|---|---|
| `SOCIAL_AUTH_TABLE_NAME` | DynamoDB table for OAuth state + encrypted connection records |
| `SOCIAL_DISTRIBUTION_TABLE_NAME` | optional override for social settings/deliveries; defaults to `SOCIAL_AUTH_TABLE_NAME` |
| `SOCIAL_DISTRIBUTION_SCHEDULER_GROUP_NAME` | optional EventBridge Scheduler group override for delayed social sends |
| `SOCIAL_AUTH_TOKEN_SECRET` | 32+ character secret used to encrypt stored provider tokens |
| `SOCIAL_AUTH_PUBLIC_API_BASE_URL` | public API base for callback construction; defaults to `https://api.grayson-wills.com/api` |
| `SOCIAL_AUTH_DEFAULT_RETURN_URL` | authoring URL after callback; defaults to `https://author.grayson-wills.com/distribution` |
| `SOCIAL_AUTH_ALLOWED_RETURN_ORIGINS` | optional comma-separated return URL allowlist |
| `SOCIAL_X_CLIENT_ID` / `SOCIAL_X_CLIENT_SECRET` | X/Twitter OAuth app credentials |
| `SOCIAL_LINKEDIN_CLIENT_ID` / `SOCIAL_LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth app credentials |
| `SOCIAL_META_CLIENT_ID` / `SOCIAL_META_CLIENT_SECRET` | Meta app credentials for Facebook + Instagram |

Provision the baseline DynamoDB table/IAM/env with:

```bash
AWS_PROFILE=grayson-sso scripts/setup_social_auth_stack.sh
```

After creating provider apps, install their client IDs/secrets without printing values:

```bash
SOCIAL_X_CLIENT_ID=... \
SOCIAL_X_CLIENT_SECRET=... \
SOCIAL_LINKEDIN_CLIENT_ID=... \
SOCIAL_LINKEDIN_CLIENT_SECRET=... \
SOCIAL_META_CLIENT_ID=... \
SOCIAL_META_CLIENT_SECRET=... \
AWS_PROFILE=grayson-sso \
scripts/set_social_provider_credentials.sh
```

The raw OAuth token payloads produced by user login are never returned to the browser. They remain encrypted in DynamoDB and should be retrieved only by backend posting workers via the social auth service.

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

## AWS Runtime Notes

Production Lambda configuration for the low-latency read path:
- architecture: `arm64`
- memory: `1024 MB`
- published alias: `live`
- provisioned concurrency on `live`: `2`

API Gateway integration should point to the alias ARN rather than `$LATEST`.

## Deployment Automation

- Lambda workflow: `/Users/grayson/Desktop/Portfolio/.github/workflows/api-deploy.yml`

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
