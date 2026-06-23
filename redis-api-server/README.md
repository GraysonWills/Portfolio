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
- `POST /api/social-auth/:provider/token/import` (auth, Instagram access-token fallback)
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
- `threads`
- `tiktok`
- `reddit`
- `pinterest`
- `mastodon`
- `tumblr`
- `medium`

Webhook-only provider IDs:
- `discord`

The callback URLs to register with each provider app are:
- `https://api.grayson-wills.com/api/social-auth/x/callback`
- `https://api.grayson-wills.com/api/social-auth/linkedin/callback`
- `https://api.grayson-wills.com/api/social-auth/facebook/callback`
- `https://api.grayson-wills.com/api/social-auth/instagram/callback`
- `https://api.grayson-wills.com/api/social-auth/threads/callback`
- `https://api.grayson-wills.com/api/social-auth/tiktok/callback`
- `https://api.grayson-wills.com/api/social-auth/reddit/callback`
- `https://api.grayson-wills.com/api/social-auth/pinterest/callback`
- `https://api.grayson-wills.com/api/social-auth/mastodon/callback`
- `https://api.grayson-wills.com/api/social-auth/tumblr/callback`
- `https://api.grayson-wills.com/api/social-auth/medium/callback`

X/Twitter uses OAuth 2.0 Authorization Code with PKCE. The requested scopes are `tweet.read`, `tweet.write`, `users.read`, `dm.read`, `dm.write`, and `offline.access`. Direct Message scopes are only credential capability at this point: the platform does not auto-send DMs, and any future DM send/read tooling should remain behind explicit UI and approval controls.

LinkedIn uses OAuth 2.0 with OpenID Connect profile scopes plus member posting. The requested scopes are `openid`, `profile`, `email`, `r_profile_basicinfo`, and `w_member_social`. `w_member_social` enables personal-profile posting. `r_profile_basicinfo` is used only for richer basic profile metadata where LinkedIn makes it available; reading historical member posts still requires restricted LinkedIn permissions such as `r_member_social`.

Instagram uses Instagram API with Instagram Login. Register the Instagram callback URL in the Instagram product OAuth settings and grant at least `instagram_business_basic` and `instagram_business_content_publish` for creator/business publishing.

When Instagram app credentials are not yet available, an authenticated author can import a generated Instagram access token through `POST /api/social-auth/instagram/token/import`. The backend validates the token against `graph.instagram.com`, refreshes it when the token supports `ig_refresh_token`, encrypts the stored credential, and auto-selects the returned creator/business account. This is a fallback for one-account operation; the preferred long-term path remains normal OAuth through the Connect button once app credentials are available.

TikTok uses Login Kit for Web. Register the TikTok callback URL as a redirect URI, configure `SOCIAL_TIKTOK_CLIENT_KEY` and `SOCIAL_TIKTOK_CLIENT_SECRET`, and grant `user.info.basic`, `video.upload`, and `video.publish` if the app has access. V1 uses the Content Posting API `MEDIA_UPLOAD` photo flow with a public image URL; TikTok returns a publish/upload id and the creator may still need to finish the upload in TikTok depending on app approval and account capability.

Reddit uses OAuth with a confidential app credential, `identity`, `submit`, `read`, and `mysubreddits` scopes, and a required API user agent. V1 submits either link posts or self posts to the connected user's profile subreddit by default, or to an explicit destination like `r/example` or `subreddit:example`.

Pinterest uses OAuth, lists boards after connection, and requires selecting a board before posting. V1 creates image pins, so the delivery must include a public cover/media URL.

Mastodon requires `SOCIAL_MASTODON_INSTANCE_URL` in addition to the OAuth client id/secret. V1 posts statuses through that instance with public/unlisted/private visibility inferred from the delivery destination.

Tumblr uses OAuth and requires selecting a blog before posting. V1 creates link posts when a blog URL is available, otherwise text posts, and can mark Tumblr deliveries as draft when the destination includes `draft`.

Medium API posting is wired for existing integrations. V1 publishes markdown content as draft/public/unlisted and sets the original blog URL as the canonical URL when available.

Discord is webhook-only. Configure `SOCIAL_DISCORD_WEBHOOK_URL`; it does not participate in OAuth status/start/callback.

YouTube, Substack, and Bluesky are not enabled as automatic V1 posting targets. YouTube's official API is video-upload oriented, Substack has no supported public posting API, and Bluesky needs a dedicated AT Protocol connector rather than the current client-secret OAuth model.

Operational flow:
1. Provider app credentials are configured once on Lambda.
2. The authoring Distribution tab calls `POST /api/social-auth/:provider/start` when Connect is pressed.
3. The backend creates a 10-minute state record, builds the provider OAuth URL, and returns it to the browser.
4. The provider redirects back to `/api/social-auth/:provider/callback` with an authorization code.
5. The backend exchanges that code for token artifacts, encrypts the raw token payload, stores it in DynamoDB, and redirects back to the authoring Distribution tab.
6. X, LinkedIn, Instagram direct-login, Threads, TikTok, Reddit, Mastodon, and Medium posting identities are selected automatically when profile lookup succeeds.
7. Facebook, Pinterest, and Tumblr require account selection after OAuth; the authoring Distribution tab calls the account list/select endpoints to choose a Facebook Page, Pinterest board, or Tumblr blog. Instagram now uses direct Instagram Login for professional creator/business accounts instead of page-linked account discovery.
8. `GET /api/social-auth/status` returns non-sensitive connection metadata such as scopes, expiry, selected account label, missing scopes, reconnect requirements, and which credential artifacts were captured.
9. Blog publish/schedule events create social delivery records from saved templates/rules. Zero-delay deliveries send inline, delayed deliveries use the existing EventBridge Scheduler target, and review-required deliveries stay in `needs_review`.

Scope drift handling:
- Provider configs are treated as the desired scope set.
- A stored connection whose token was minted before a newly requested scope is added returns `status: "needs-reconnect"`, `needsReconnect: true`, and `missingScopes`.
- The old token is not returned to the browser; reconnecting through the provider OAuth flow is the only way to grant the additional scopes.

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
| `SOCIAL_META_CLIENT_ID` / `SOCIAL_META_CLIENT_SECRET` | Meta app credentials for Facebook Page OAuth |
| `SOCIAL_INSTAGRAM_CLIENT_ID` / `SOCIAL_INSTAGRAM_CLIENT_SECRET` | Instagram App credentials for direct Instagram Login |
| `SOCIAL_THREADS_CLIENT_ID` / `SOCIAL_THREADS_CLIENT_SECRET` | Threads OAuth app credentials |
| `SOCIAL_TIKTOK_CLIENT_KEY` / `SOCIAL_TIKTOK_CLIENT_SECRET` | TikTok Login Kit app credentials |
| `SOCIAL_REDDIT_CLIENT_ID` / `SOCIAL_REDDIT_CLIENT_SECRET` | Reddit OAuth app credentials |
| `SOCIAL_REDDIT_USER_AGENT` | optional Reddit API user agent override |
| `SOCIAL_PINTEREST_CLIENT_ID` / `SOCIAL_PINTEREST_CLIENT_SECRET` | Pinterest OAuth app credentials |
| `SOCIAL_MASTODON_INSTANCE_URL` | Mastodon instance base URL, for example `https://mastodon.social` |
| `SOCIAL_MASTODON_CLIENT_ID` / `SOCIAL_MASTODON_CLIENT_SECRET` | Mastodon OAuth app credentials for the configured instance |
| `SOCIAL_TUMBLR_CLIENT_ID` / `SOCIAL_TUMBLR_CLIENT_SECRET` | Tumblr OAuth app credentials |
| `SOCIAL_MEDIUM_CLIENT_ID` / `SOCIAL_MEDIUM_CLIENT_SECRET` | Medium API integration credentials where available |
| `SOCIAL_DISCORD_WEBHOOK_URL` | Discord announcement webhook URL |

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
SOCIAL_INSTAGRAM_CLIENT_ID=... \
SOCIAL_INSTAGRAM_CLIENT_SECRET=... \
SOCIAL_THREADS_CLIENT_ID=... \
SOCIAL_THREADS_CLIENT_SECRET=... \
SOCIAL_TIKTOK_CLIENT_KEY=... \
SOCIAL_TIKTOK_CLIENT_SECRET=... \
AWS_PROFILE=grayson-sso \
scripts/set_social_provider_credentials.sh
```

The raw OAuth token payloads produced by user login are never returned to the browser. They remain encrypted in DynamoDB and should be retrieved only by backend posting workers via the social auth service.

### MCP Authoring Gateway

| Variable | Purpose |
|---|---|
| `MCP_CONTROL_TABLE_NAME` | DynamoDB table for MCP clients, token indexes, audit records, rate counters, idempotency records, and approvals |
| `MCP_TOKEN_HASH_SECRET` | optional HMAC secret for machine-token hashing; falls back to `SOCIAL_AUTH_TOKEN_SECRET` / `TOKEN_ENCRYPTION_SECRET` |

Provision the low-cost on-demand control table/IAM/env with:

```bash
AWS_PROFILE=grayson-sso scripts/setup_mcp_authoring_stack.sh
```

Remote MCP is mounted at `/api/mcp` using Streamable HTTP and `Authorization: Bearer mcp_...`. Tokens are per-machine credentials created in the authoring GUI and should be stored in Keychain:

```bash
read -rsp "MCP token: " MCP_TOKEN; echo
security add-generic-password -a "$(hostname)" -s portfolio-mcp-authoring -w "$MCP_TOKEN" -U
unset MCP_TOKEN
```

Normal Cognito authoring auth manages clients and approvals:

- `POST /api/mcp/clients`
- `GET /api/mcp/clients`
- `DELETE /api/mcp/clients/:clientId`
- `GET /api/mcp/approvals`
- `POST /api/mcp/approvals/:approvalId/approve`
- `POST /api/mcp/approvals/:approvalId/reject`

Canonical blog APIs are mounted at `/api/blog/posts`, `/api/blog/categories`, and `/api/blog/schedules`.
MCP clients can create, update, and delete isolated drafts they own, plus create preview sessions directly. Approval-backed actions either enter the human approval queue or auto-execute immediately when the calling client's `autoExecuteActions` allowlist includes that action.

Current MCP tool groups:
- Read: `site.get_inventory`, `content.list`, `content.get`, `blog.list_posts`, `blog.get_post`, `media.list_assets`, `comments.list_recent`, `comments.get_thread`, `social.get_status`, `social.list_deliveries`.
- Direct draft/previews: `blog.create_draft`, `blog.update_mcp_draft`, `blog.delete_mcp_draft`, `preview.create`, `media.upload_image_from_url`, `social.create_delivery_draft`.
- Approval-backed: `blog.propose_update`, `blog.request_publish`, `blog.request_schedule`, `blog.request_unpublish`, `blog.request_delete`, `content.propose_update`, `media.request_delete`, `comments.propose_reply`, `comments.request_delete`, `social.propose_settings_update`, `social.request_send_delivery`.

Mutation and approval tools accept optional `idempotencyKey`; replayed requests return the stored result instead of running the mutation again. `blog.delete_mcp_draft` rejects non-owned drafts and supports `expectedVersion` or `expectedUpdatedAt` concurrency checks. `content.propose_update` accepts an optional `route` so reviewers can open a generated preview URL.

Auto-execute policy:
- Stored per MCP client as `autoExecuteActions`.
- Recommended actions: `blog.propose_update`, `blog.request_publish`, `blog.request_schedule`, `blog.request_unpublish`, `content.propose_update`, `comments.propose_reply`, `social.propose_settings_update`.
- Risky actions are opt-in/manual by default: `blog.request_delete`, `media.request_delete`, `comments.request_delete`, `social.request_send_delivery`.
- Auto-executed actions still create approval records, immediately mark them `executed` or `failed`, and write MCP audit records.

Smoke tests:

```bash
# Local contract/read smoke.
node ../scripts/mcp_smoke.mjs --mode local-contract --read-only

# Live read-only smoke.
MCP_BASE_URL=https://api.grayson-wills.com/api/mcp node ../scripts/mcp_smoke.mjs --mode prod-smoke --read-only

# Live disposable draft create/update/delete smoke.
MCP_BASE_URL=https://api.grayson-wills.com/api/mcp node ../scripts/mcp_smoke.mjs --mode prod-smoke
```

Troubleshooting:
- `401` means the token is missing, invalid, expired, or revoked.
- `403` means the client lacks the required tool scope.
- `409` means a concurrency precondition or idempotency payload mismatch failed.
- The smoke script never prints raw token material and cleans up `mcp-smoke-*` draft records on success or failure.

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
