# MCP Implementation Playbook (Deferred)

Status: Planning only (no MCP runtime deployed)
Last updated: 2026-02-22

## Goal

Enable a future LLM control plane for blog authoring and full portfolio content updates through MCP, while preserving strict security boundaries and auditability.

## Preconditions

1. Keep MCP endpoint private (VPC-only), not public internet-facing.
2. Keep existing CloudFront + API user traffic unchanged.
3. Enforce least privilege for any machine identity used by MCP clients.
4. Add full request/response audit logging before enabling write tools.

## Recommended Target Architecture

1. New private service: `mcp-blog-gateway` (Node + MCP SDK).
2. Service-to-service calls from gateway to `redis-api-server` internal endpoints.
3. Tool-level authorization and schema validation in MCP gateway.
4. Observability:
   - CloudWatch logs and metrics
   - structured audit trail per tool call
   - alerting on write failures and excessive mutation rates

## Step-by-Step Implementation Plan

### Phase 1: API Hardening (required before MCP)

1. Add canonical post-level API endpoints to `redis-api-server`:
   - `POST /api/blog/posts`
   - `PUT /api/blog/posts/:listItemID`
   - `GET /api/blog/posts`
   - `GET /api/blog/posts/:listItemID`
   - `DELETE /api/blog/posts/:listItemID`
2. Add category registry endpoints:
   - `GET /api/blog/categories`
   - `POST /api/blog/categories`
   - `PUT /api/blog/categories/:id`
   - `DELETE /api/blog/categories/:id` (archive)
3. Add strict payload schemas (AJV/Zod) for:
   - blog post metadata
   - blog body blocks
   - project content records
   - work skill metric records
4. Add optimistic concurrency:
   - `expectedVersion` or `expectedUpdatedAt` on writes.
5. Add idempotency keys for write endpoints:
   - `Idempotency-Key` header support.
6. Add schedule visibility endpoints:
   - list schedules, status, next run, and failure reason.

### Phase 2: MCP Gateway Service

1. Scaffold `mcp-blog-gateway` with MCP Streamable HTTP transport.
2. Implement read-only tools first:
   - `blog.list_posts`
   - `blog.get_post`
   - `content.list`
   - `content.get`
   - `blog.list_categories`
3. Implement write tools after audits pass:
   - `blog.create_post`
   - `blog.update_post`
   - `blog.delete_post`
   - `blog.schedule_publish`
   - `blog.publish_now`
   - `media.upload_image_from_url`
4. Add preview tooling:
   - `preview.create_session`
   - `preview.get_url`
5. Add hard guardrails:
   - per-tool input validation
   - content policy checks
   - destructive-operation confirmation mode
   - mutation rate limits

### Phase 3: Security and Networking

1. Deploy MCP gateway in private subnets.
2. Restrict ingress to approved internal clients only.
3. Use scoped JWT/OAuth or signed service identity for MCP clients.
4. Deny token passthrough to downstream APIs.
5. Enable WAF/rate limiting at any public boundary (if one exists).

### Phase 4: Integration and Rollout

1. Add a non-production MCP environment first.
2. Run contract tests for each tool.
3. Run abuse tests:
   - malformed payloads
   - replay attempts
   - excessive write patterns
4. Add human approval requirement for delete/archive tools.
5. Enable production in read-only mode first.
6. Enable write tools incrementally by scope.

## Validation Checklist (Go/No-Go)

- [ ] Private-only MCP ingress enforced.
- [ ] All write tools schema-validated.
- [ ] Idempotency and concurrency controls active.
- [ ] Audit log contains actor, tool, target IDs, and timestamp.
- [ ] Rollback workflow documented and tested.
- [ ] Cost and rate limits configured.
- [ ] On-call alerting configured for failed writes and auth anomalies.

## Runbook Pointers

- Planning baseline and current gap analysis:
  - `/Users/grayson/Desktop/Portfolio/design/mcp-integration/blog-authoring-mcp-readiness-audit.md`
- This implementation sequence:
  - `/Users/grayson/Desktop/Portfolio/design/mcp-integration/mcp-implementation-playbook.md`

