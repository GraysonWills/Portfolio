# Blog Authoring GUI (`blog-authoring-gui`)

Authenticated Angular authoring console for portfolio/blog/site content.

## Current Feature Set

- Cognito auth routes:
  - `/login`
  - `/register`
  - `/forgot-password`
- Guarded admin routes:
  - `/dashboard`
  - `/content`
  - `/subscribers`
  - `/collections`
- Blog lifecycle:
  - create/edit/delete
  - draft/scheduled/published states
  - explicit unpublish action (moves post to draft + hides from portfolio)
  - send-now + scheduled email integration.
- Full-site preview session flow against deployed portfolio routes.
- Content Studio for direct `PageID`/`PageContentID` editing.
- Subscriber admin management (list/add/remove).
- Collections authoring (`PageID=4`) for non-blog written content types.
- Photo asset upload flow (signed URL + complete lifecycle).
- Inline editor image guard:
  - detects embedded `data:image/*` tags before save
  - uploads those assets via API and rewrites post HTML to URL-based images
  - avoids API `413 request entity too large` failures on large posts
- Route-scoped `v2`/`v3` reading with in-memory request reuse and fallback to legacy reads.
- Keyboard shortcuts with global + page-scoped contexts.

## Auth and Session Behavior

Implemented in `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts`:

- Cognito user-pool authentication.
- Stored session persistence on device (ID/access/refresh token payload).
- Auto-refresh when token approaches expiry.
- Login throttle:
  - max 5 failed attempts
  - rolling 5-minute window
  - lockout resets automatically after window expiry.

## API Dependencies

Configured in `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/environments/environment*.ts`.

```ts
redisApiUrl: 'https://api.grayson-wills.com/api' // prod
useContentV2Stream: true
useBlogV2Cards: true
portfolioPreviewUrl: 'https://www.grayson-wills.com'
```

Main consumed APIs:
- `/api/content/*` and `/api/content/v2/*`
- `/api/content/v3/bootstrap`
- `/api/content/v3/admin/dashboard`
- `/api/content/v3/admin/content`
- `/api/notifications/*`
- includes `/api/notifications/unpublish`
- `/api/subscriptions/*`
- `/api/photo-assets/*`
- `/api/upload/image`
- `/api/health`

Normal route entry no longer calls `/api/health`; connectivity checks are now settings/diagnostics actions only.

## Loading Strategy

- Dashboard:
  - reads metadata/status counts from `GET /api/content/v3/admin/dashboard`
  - hydrates visible cover images lazily
  - paginates additional cards instead of preloading all posts
- Content Studio:
  - reads server-filtered rows from `GET /api/content/v3/admin/content`
  - uses page/content targeted queries behind the API
  - loads additional rows incrementally
- Dynamic content snapshots are no longer persisted in browser storage.
- Reuse is limited to current-session in-memory streams keyed by route/query shape.

Scheduling dependency note:
- Blog scheduling in dashboard requires API Lambda env vars:
  - `SCHEDULER_INVOKE_ROLE_ARN`
  - `SCHEDULER_TARGET_LAMBDA_ARN`
  - `SCHEDULER_GROUP_NAME` (optional; defaults to `portfolio-email`)

## Hotkeys

Open shortcuts dialog: `Cmd/Ctrl + Alt + /`

Global:
- `Cmd/Ctrl + Alt + 1` Dashboard
- `Cmd/Ctrl + Alt + 2` Content Studio
- `Cmd/Ctrl + Alt + 3` Subscribers
- `Cmd/Ctrl + Alt + 4` Collections

Page defaults:
- `Cmd/Ctrl + Alt + R` refresh
- `Cmd/Ctrl + Alt + N` create new (where applicable)

Implementation references:
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/hotkeys.service.ts`
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app.component.ts`

## Local Development

Prerequisites:
- Node.js 22.x
- npm 10+
- Angular CLI 19+
- running API server
- configured Cognito app client/user pool

Run:

```bash
cd /Users/grayson/Desktop/Portfolio/blog-authoring-gui
npm ci
npm start -- --port 4301
```

Open: `http://localhost:4301`

## Build + Test

```bash
cd /Users/grayson/Desktop/Portfolio/blog-authoring-gui
npm test -- --watch=false --browsers=ChromeHeadless --no-progress
npm run build -- --configuration=production
```

## Deployment

Automated by:
- `/Users/grayson/Desktop/Portfolio/.github/workflows/ci-cd.yml`

Production target:
- S3 bucket: `grayson-wills-blog-authoring-dev-381492289909`
- CloudFront distribution: `E31OPQLJ4WFI66`

Operational note:
- After API deploys that affect subscriptions/notifications, run the Lambda↔SES verification checklist in `/Users/grayson/Desktop/Portfolio/README.md` ("Required Post-Deploy Email Safety Check").

## Key Files

- App routing shell: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app-routing.module.ts`
- Admin route module: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/features/admin/admin-routing.module.ts`
- Auth route module: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/features/auth/auth-routing.module.ts`
- API client: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts`

Further rollout notes:
- `/Users/grayson/Desktop/Portfolio/docs/no-cache-performance-rollout.md`
