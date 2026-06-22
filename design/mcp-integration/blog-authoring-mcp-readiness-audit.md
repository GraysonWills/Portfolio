# Blog Authoring MCP Readiness Audit

Date: 2026-06-15
Scope: `blog-authoring-gui`, `redis-api-server`, `portfolio-app` preview paths
Status: Gateway implemented; hardening and live smoke coverage are ongoing.

## Executive Decision

The portfolio now uses an in-process MCP Streamable HTTP gateway mounted at `/api/mcp` in `redis-api-server`. This replaced the earlier deferred plan for a separate private `mcp-blog-gateway` service while preserving the important safety goals: scoped machine identities, validated domain tools, audit records, rate limits, idempotency, and human approval for public or destructive actions.

The endpoint is internet-reachable behind the API custom domain, so security now depends on strong bearer-token handling, least-privilege scopes, expiration/revocation, auditability, production smoke tests, and denial-by-default behavior for unauthenticated traffic.

## Implemented Capabilities

- MCP transport and tool registry:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/mcp.js`
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/mcp-tools.js`
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/mcp-control.js`
- Canonical blog service and routes:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/blog-posts.js`
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/blog.js`
- Authoring GUI client/approval controls:
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/pages/ai-queue/ai-queue.component.ts`
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/blog-api.service.ts`
- Portfolio preview consumption remains unchanged and tokenized:
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/redis.service.ts`

## Current Safety Model

- Per-machine `mcp_...` bearer tokens are created and revoked through the Cognito-protected authoring GUI.
- Tokens are scoped and expiring; local machines should store them in macOS Keychain under service `portfolio-mcp-authoring` and account `$(hostname)`.
- Direct MCP writes are limited to owned drafts, previews, draft assets, and social delivery drafts.
- `blog.delete_mcp_draft` deletes only drafts created by the same MCP client and supports concurrency checks.
- Publish, schedule, unpublish, public delete, media delete, comment moderation, and social send tools create approval records. Per-client `autoExecuteActions` can immediately execute selected records while preserving executed/failed history.
- Mutation and approval tools accept `idempotencyKey` and use MCP idempotency storage for replay safety.
- Audit records, rate counters, token indexes, client metadata, approvals, and idempotency records live in the MCP control table.

## Implemented Tool Surface

Read tools:
- `site.get_inventory`
- `content.list`
- `content.get`
- `blog.list_posts`
- `blog.get_post`
- `media.list_assets`
- `comments.list_recent`
- `comments.get_thread`
- `social.get_status`
- `social.list_deliveries`

Direct draft/preview tools:
- `blog.create_draft`
- `blog.update_mcp_draft`
- `blog.delete_mcp_draft`
- `preview.create`
- `media.upload_image_from_url`
- `social.create_delivery_draft`

Approval-backed tools:
- `blog.propose_update`
- `blog.request_publish`
- `blog.request_schedule`
- `blog.request_unpublish`
- `blog.request_delete`
- `content.propose_update`
- `media.request_delete`
- `comments.propose_reply`
- `comments.request_delete`
- `social.propose_settings_update`
- `social.request_send_delivery`

## Remaining Hardening Backlog

- Keep expanding protocol tests around malformed JSON-RPC, header variants, auth edge cases, revocation, expiry, rate limits, and audit records.
- Keep approval execution tests broad enough to cover approve, reject, expired, and downstream-failure paths.
- Continue production smoke checks as non-destructive operator-triggered runs.
- Add deeper malicious HTML/content policy tests around AI-generated body content before public publish.
- Continue moving any hardcoded profile/contact/skills data toward canonical content records where practical.

## Go/No-Go Criteria

Production write scopes should remain enabled only when all of these stay true:
- Missing or bad MCP tokens return `401`.
- Scope denial returns `403`.
- Draft mutations reject non-owned records.
- Idempotent replay is stable and changed-payload replay is rejected.
- Public/destructive actions either require approval or must be explicitly allowed in a client's `autoExecuteActions` policy.
- Smoke-created `mcp-smoke-*` records are cleaned up.
- Raw tokens are never logged, stored in plain text, or embedded in generated config snippets.
