# Blog Authoring MCP Readiness Audit

Date: 2026-02-21
Scope: `blog-authoring-gui`, `redis-api-server`, `portfolio-app` (preview paths)

## Executive Decision

Recommended approach: build a **private MCP gateway service** that wraps domain-safe blog/content operations, instead of exposing generic content CRUD directly to an LLM.

Reason:
- The current REST API is powerful but too generic for direct autonomous writes.
- A dedicated MCP layer gives tool-level safety, validation, and least-privilege controls.
- You keep the existing CloudFront UX unchanged while adding AI automation safely.

## Current Capability Runthrough

### 1) Blog authoring app surface (already present)

- Auth via Cognito session:
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts`
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/interceptors/auth.interceptor.ts`
- Blog dashboard list/edit/delete:
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/pages/dashboard/dashboard.component.ts`
- Blog editor fields (title, summary, content, tags, publish date, status, category, email toggle):
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.ts`
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.html`
- Image upload with compression:
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/components/image-uploader/image-uploader.component.ts`
- Whole-site raw content editing ("Content Studio"):
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/pages/content-studio/content-studio.component.ts`

### 2) Backend API surface (already present)

- Generic content CRUD + batch + preview sessions:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/content.js`
- Upload endpoint:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/upload.js`
- Schedule/publish/notify endpoints:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/notifications.js`
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/notifications.js`
- Subscription lifecycle:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/subscriptions.js`
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/subscriptions.js`

### 3) Portfolio preview consumption (already present)

- Tokenized preview sessions merged into live content:
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/redis.service.ts`
- Preview token routing/session behavior:
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/app.component.ts`

## Gaps Blocking Safe "Fully Editable via MCP"

### A. No MCP server exists yet

- No MCP transport endpoint or tool registry in the repo.
- No explicit tool permission model for AI-only operations.

### B. Generic CRUD is too low-level for LLM autonomy

Current direct writes use raw `/content` records, which can break rendering if fields are malformed.

Needed:
- Domain-safe blog endpoints (post-level abstraction) or strict MCP-side schema guards.
- Strong validation for `Metadata`, `BlogBody`, and `PageContentID`-specific payload shapes.

### C. Blog write path is not normalized to rich body structure

In `blog-authoring-gui`, create/update paths write `BlogText` and sometimes `BlogImage`, but not consistently `BlogBody`.
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts`

Needed:
- Canonical body storage contract (`BlogBody` as structured blocks) for all new/updated posts.

### D. Category management is free-text only

Categories are entered as raw text; there is no canonical taxonomy endpoint/table.

Needed:
- Category registry (create/rename/archive/list) so MCP tools can edit categories safely without drift.

### E. No optimistic concurrency or idempotency on writes

Needed:
- `version` or `UpdatedAt` precondition checks.
- `Idempotency-Key` support on create/update/schedule operations.

### F. Scheduling observability is limited

Current API can create/cancel schedules but does not expose a robust "list queue/status/errors" contract for AI orchestration.

Needed:
- Read endpoints for schedule state, last run, next run, and failure reason.

### G. Upload flow is UI-centric

`/upload/image` expects multipart browser file; MCP automation also needs:
- upload by local path
- upload by URL
- clear return contract (asset id, URL, dimensions, checksum)

### H. Security hardening needed for AI-generated content

`blog-detail` rendering trusts HTML/markdown output with bypass sanitizer calls:
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.ts`

Needed:
- Server-side sanitization policy for AI-authored content before publish.

### I. Not all displayed site data is content-store driven

Some "profile/contact/skills/certifications/experience" values are still hardcoded in `LinkedInDataService`, which can diverge from content records and reduce true editability:
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/linkedin-data.service.ts`

Needed:
- Move these values to canonical content records (or dedicated profile settings records).
- Keep code defaults only as emergency fallback, not as primary display source.

## Recommended Architecture

### Control plane

1. Add new service: `mcp-blog-gateway` (Node, MCP SDK).
2. Keep it private in AWS (VPC-only ingress).
3. MCP gateway calls internal backend APIs (or service layer) with a scoped service identity.

### Data plane

1. Continue using existing content backend (`DynamoDB` primary / Redis compatibility path).
2. Route all AI write operations through validated post/content service methods.
3. Keep CloudFront app read path unchanged.

### Why this is best for this repo

- Zero CloudFront UI coupling.
- Safer than exposing generic content routes as LLM tools.
- Reuses existing preview/session and scheduling workflows.

## Proposed MCP Tool Set (v1)

### Blog lifecycle tools

- `blog.list_posts(filters)`
- `blog.get_post(listItemID)`
- `blog.create_post(draft)`
- `blog.update_post(listItemID, patch)`
- `blog.delete_post(listItemID)`
- `blog.publish_now(listItemID, sendEmail)`
- `blog.schedule_publish(listItemID, publishAt, sendEmail)`
- `blog.cancel_schedule(scheduleName)`

### Media tools

- `media.upload_image_from_path(path, alt, usage)`
- `media.upload_image_from_url(url, alt, usage)`
- `media.delete_unused_asset(assetId)`

### Category tools

- `blog.list_categories()`
- `blog.create_category(name, slug)`
- `blog.rename_category(id, name, slug)`
- `blog.archive_category(id)`

### Whole-site content tools

- `content.list(pageID?, pageContentID?, listItemID?)`
- `content.get(id)`
- `content.upsert(item, expectedVersion?)`
- `content.delete(id, expectedVersion?)`

### Preview and validation tools

- `preview.create_session(upserts, deleteIds, route)`
- `preview.get_url(token, route)`
- `content.validate(itemOrPost)` (schema + policy checks)

## Required Code Changes (Validated)

### Backend (`redis-api-server`)

1. Add strict schemas per content type and blog post model (AJV or Zod).
2. Add canonical post-level endpoints (`/api/blog/posts/...`) to avoid multi-record inconsistency.
3. Add category registry storage and endpoints.
4. Add idempotency + optimistic concurrency support.
5. Add schedule inspection endpoint(s).
6. Add content sanitization pipeline before publish.
7. Add internal auth mode for MCP gateway service-to-service calls.

### Blog Authoring GUI (`blog-authoring-gui`)

1. Switch blog save/update calls to canonical post endpoints.
2. Persist `BlogBody` consistently.
3. Replace free-text category input with managed category picker.
4. Add schedule status display (pending/running/failed) from new schedule read API.

### Portfolio App (`portfolio-app`)

1. Continue current preview model; no major routing changes required.
2. Ensure blog renderer remains robust when rich blocks are canonicalized.
3. Add strict fallback handling when category/status metadata is missing.
4. Shift profile/contact/skills/certification display to canonical content-store reads.

## Security Requirements for MCP Rollout

1. Private ingress only (no public MCP endpoint).
2. Scoped auth for MCP client identity; no shared admin token.
3. Tool-level allow/deny policy:
   - read-only tools vs mutating tools
   - optional approval gate for destructive actions
4. Full audit logs:
   - actor
   - tool
   - input hash
   - changed record IDs
   - timestamp
5. Rate limiting and budget guardrails on mutation tools.

## Phased Implementation Plan

### Phase 1: Safety Foundation

- Introduce schemas, idempotency, optimistic concurrency, and canonical blog post service.
- Add category registry and schedule read endpoints.

### Phase 2: MCP Gateway

- Implement MCP server with read/write tool split.
- Wire private auth and audit logging.
- Add preview tools.

### Phase 3: GUI Alignment

- Update GUI to canonical endpoints and category registry.
- Add schedule queue/status views.

### Phase 4: Hardening and Test

- Contract tests for each MCP tool.
- Negative tests (malformed payload, unauthorized actions, replay).
- End-to-end publish/schedule/preview tests.

## Go/No-Go Criteria

Go only if all are true:
- No public MCP ingress.
- Mutating tools enforce schema and concurrency checks.
- Full audit logs available.
- Preview-first workflow validated before publish.
- Rollback path tested for bad AI writes.
