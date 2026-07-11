# Blog Authoring GUI (`blog-authoring-gui`)

Authenticated Angular authoring console for portfolio/blog/site content.

The private Capacitor iPhone build, security model, signing steps, and physical-device acceptance checklist are documented in [`../docs/ios-author-studio.md`](../docs/ios-author-studio.md).

## Current Feature Set

- Cognito auth routes:
  - `/login`
  - `/register`
  - `/forgot-password`
- Guarded admin routes:
  - `/dashboard`
  - `/content`
  - `/subscribers`
  - `/comments`
  - `/collections`
- Blog lifecycle:
  - create/edit/delete
  - draft/scheduled/published states
  - explicit unpublish action (moves post to draft + hides from portfolio)
  - send-now + scheduled email integration
  - editable read time override (`readTimeMinutes`)
- Full-site preview session flow against deployed portfolio routes.
- Content Studio with a structured editing workspace:
  - left-side section map
  - center page simulation canvas
  - right-side typed inspector
  - drag/drop ordering for ordered content blocks
  - typed fields for titles, summaries, dates, locations, links, tags, read time, and visibility where applicable
  - raw-record modal retained as an advanced fallback
- Subscriber admin management (list/add/remove).
- Comment management (list/filter, author replies, soft-delete moderation).
- AI Clients page for per-machine MCP token creation/revocation, scope presets, limits, Keychain setup, and approval queue handling.
- Collections authoring (`PageID=4`) for non-blog written content types.
- Photo asset upload flow (signed URL + complete lifecycle).
- Distribution OAuth cards show live connection state, selected posting identity, expiry, reconnect requirements, and missing provider scopes for X/Twitter, LinkedIn, Facebook, Instagram, Threads, TikTok, Reddit, Pinterest, Mastodon, Tumblr, and Medium.
- TikTok distribution starts with photo upload support through the official Content Posting API and requires a public cover/media URL.
- Reddit supports profile or subreddit link/self posts after OAuth. Pinterest requires choosing a board and a public image URL. Mastodon requires a configured instance. Tumblr requires choosing a blog. Medium creates API-backed drafts/posts when credentials are available.
- Discord appears as a webhook-backed manual connector and uses the backend `SOCIAL_DISCORD_WEBHOOK_URL` instead of OAuth.
- YouTube, Substack, and Bluesky remain disabled in Distribution V1 until a supported official connector is added.
- Inline editor image guard:
  - detects embedded `data:image/*` tags before save
  - uploads those assets via API and rewrites post HTML to URL-based images
  - avoids API `413 request entity too large` failures on large posts
- Blog save path maintains both `BlogText` and canonical `BlogBody` records to keep authoring, preview, and public rendering aligned
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
- `/api/blog/posts/*` for canonical blog create/update/get/delete
- `/api/mcp/clients` and `/api/mcp/approvals/*` for AI client and approval management
- `/api/notifications/*`
- includes `/api/notifications/unpublish`
- `/api/comments/*`
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
  - groups raw records into human-facing sections (hero slides, timeline entries, project cards, footer links, etc.)
  - exposes typed editors for common content kinds while preserving the same backend JSON/metadata model
  - loads additional rows incrementally
- Blog editor:
  - creates, updates, reads, and deletes posts through canonical `/api/blog/posts` APIs
  - sends `expectedVersion` or `expectedUpdatedAt` when updating/deleting existing posts
  - loads canonical post body from `BlogBody` first, then falls back to `BlogText`
  - preserves manual read time when supplied
  - rewrites inline base64 images to uploaded URLs before save
- Dynamic content snapshots are no longer persisted in browser storage.
- Reuse is limited to current-session in-memory streams keyed by route/query shape.

Scheduling dependency note:
- Blog scheduling in dashboard requires API Lambda env vars:
  - `SCHEDULER_INVOKE_ROLE_ARN`
  - `SCHEDULER_TARGET_LAMBDA_ARN`
  - `SCHEDULER_GROUP_NAME` (optional; defaults to `portfolio-email`)

Social connection note:
- X/Twitter now asks for `dm.read` and `dm.write` in addition to post/user scopes. If an older X token does not include those scopes, the Distribution tab shows `Reconnect needed` and lists the missing scopes.
- DM scopes are credential-only for now; the UI does not expose inbox reading or Direct Message sending, and social automation must not send DMs automatically.
- LinkedIn requests `openid`, `profile`, `email`, `r_profile_basicinfo`, and `w_member_social`. Existing LinkedIn tokens missing `r_profile_basicinfo` show `Reconnect needed`; this can expand basic profile metadata but does not grant historical post reads.
- Account selection is required after OAuth for Facebook Pages, Pinterest boards, and Tumblr blogs. Single-identity providers such as X, LinkedIn, Instagram direct login, Threads, TikTok, Reddit, Mastodon, and Medium are selected automatically when profile lookup succeeds.

## AI Clients + MCP

The AI Clients page creates scoped `mcp_...` tokens for machines that need to call `/api/mcp`. The raw token is shown only at creation time. Use the page-provided Keychain command, or this equivalent, so the token does not land in shell history:

```bash
read -rsp "MCP token: " MCP_TOKEN; echo
security add-generic-password -a "$(hostname)" -s portfolio-mcp-authoring -w "$MCP_TOKEN" -U
unset MCP_TOKEN
```

The MCP config snippet should reference `${MCP_BEARER_TOKEN}` or rely on the smoke script's Keychain lookup. Scope presets are available for read-only, draft-only, recommended authoring, and full coverage. Auto-execute presets are separate from scopes: "Auto most" covers blog/content updates, publish, schedule, unpublish, comment replies, and social settings; deletes and social sends are marked risky and remain manual unless selected. Auto-executed actions still appear as executed approval-history records.

Useful checks:

```bash
node /Users/grayson/Desktop/Portfolio/scripts/mcp_smoke.mjs --mode prod-smoke --read-only
MCP_BASE_URL=https://api.grayson-wills.com/api/mcp node /Users/grayson/Desktop/Portfolio/scripts/mcp_smoke.mjs --mode prod-smoke
```

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

Dashboard:
- `Cmd/Ctrl + Alt + S` toggle settings
- `Cmd/Ctrl + Alt + T` toggle transaction log

Blog editor (inside Dashboard):
- `Cmd/Ctrl + Shift + S` save post
- `Cmd/Ctrl + Shift + C` preview blog card
- `Cmd/Ctrl + Shift + F` preview full post
- `Cmd/Ctrl + Shift + L` preview on portfolio blog list
- `Cmd/Ctrl + Shift + P` preview on portfolio post page
- `Cmd/Ctrl + Shift + I` insert featured image into post body
- `Cmd/Ctrl + Shift + U` unpublish current post
- `Esc` close preview or cancel editor

Content Studio:
- `Cmd/Ctrl + Alt + S` toggle API settings
- `Cmd/Ctrl + Alt + P` preview selected page in portfolio
- `Cmd/Ctrl + Shift + H / L` select previous or next section
- `Cmd/Ctrl + Shift + K / J` select previous or next entry
- `Cmd/Ctrl + Shift + , / .` move selected entry up or down
- `Cmd/Ctrl + Shift + S` save selected inspector/raw changes
- `Cmd/Ctrl + Shift + E` open advanced editor for selected entry
- `Cmd/Ctrl + Shift + D` delete selected entry
- `Esc` close active editor/settings

Subscribers:
- `Cmd/Ctrl + Shift + S` save the active local preference draft
- `Esc` cancel the active preference edit

Collections:
- `Cmd/Ctrl + Shift + A` add category tab
- `Cmd/Ctrl + Shift + S` save current collection entry
- `Esc` close the collection entry editor

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
