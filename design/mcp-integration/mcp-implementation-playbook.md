# MCP Implementation Playbook

Status: Implemented gateway with active hardening
Last updated: 2026-06-15

## Goal

Maintain a safe MCP control plane for blog authoring and portfolio content updates while preserving the public portfolio read path, auditability, and per-client control over which public actions may auto-execute.

## Current Architecture

1. `redis-api-server` mounts an in-process MCP Streamable HTTP endpoint at `/api/mcp`.
2. MCP clients authenticate with `Authorization: Bearer mcp_...`.
3. Client metadata, token hashes, audits, rate counters, idempotency records, and approvals live in the MCP control DynamoDB table.
4. The authoring GUI manages machine clients, scope presets, auto-execute action allowlists, revocation, token setup guidance, and approval approve/reject actions.
5. Canonical blog writes use `/api/blog/posts` service methods so MCP and GUI behavior share the same post-level contract.

## Token Setup

Create a scoped machine token in the authoring GUI AI Clients page, then store it locally without printing it:

```bash
read -rsp "MCP token: " MCP_TOKEN; echo
security add-generic-password -a "$(hostname)" -s portfolio-mcp-authoring -w "$MCP_TOKEN" -U
unset MCP_TOKEN
```

The smoke runner checks `MCP_BEARER_TOKEN` first, then Keychain service `portfolio-mcp-authoring` and account `$(hostname)`. Do not paste raw tokens into committed files, shell scripts, MCP config checked into source control, screenshots, logs, or Notion task notes.

## Safety Policy

- Read tools require read scopes only.
- Direct mutations are limited to draft-safe operations: create owned draft, update owned draft, delete owned draft, create previews, upload draft images, and create social delivery drafts.
- Approval-backed operations create approval-history records. They auto-execute only when the client allowlist includes that action; otherwise they remain pending for human review.
- Recommended auto-execute actions are blog/content updates, publish, schedule, unpublish, comment replies, and social settings. Deletes and social sends are opt-in risky actions.
- Mutation and approval tools should pass `idempotencyKey` for retryable callers.
- Draft update/delete callers should pass `expectedVersion` or `expectedUpdatedAt` when they have a prior read.

## Local Validation

```bash
cd /Users/grayson/Desktop/Portfolio/redis-api-server
npm test

cd /Users/grayson/Desktop/Portfolio/blog-authoring-gui
npm test -- --watch=false --browsers=ChromeHeadless --no-progress
npm run build -- --configuration=production

cd /Users/grayson/Desktop/Portfolio/portfolio-app
npm test -- --watch=false --browsers=ChromeHeadless --no-progress
npm run build -- --configuration=production

cd /Users/grayson/Desktop/Portfolio
node --check scripts/mcp_smoke.mjs
bash -n scripts/smoke_prod.sh
```

## Smoke Runs

```bash
# Local API contract/read smoke.
node scripts/mcp_smoke.mjs --mode local-contract --read-only

# Sandbox with explicit endpoint.
MCP_BASE_URL=https://sandbox.example/api/mcp node scripts/mcp_smoke.mjs --mode sandbox-e2e

# Production read-only smoke.
MCP_BASE_URL=https://api.grayson-wills.com/api/mcp node scripts/mcp_smoke.mjs --mode prod-smoke --read-only

# Production disposable owned-draft mutation smoke.
MCP_BASE_URL=https://api.grayson-wills.com/api/mcp node scripts/mcp_smoke.mjs --mode prod-smoke
```

`scripts/smoke_prod.sh` always checks unauthenticated `/api/mcp` denial. It runs the authenticated smoke only when `MCP_BEARER_TOKEN` is configured or `RUN_MCP_AUTH_SMOKE=true` allows Keychain lookup.

## Operational Checklist

- Verify new clients have the minimum required scopes and an expiration date.
- Revoke unused clients from the AI Clients page.
- Inspect pending and executed approval-history records before approving or auditing public publish/schedule/delete/social/moderation work.
- For live smoke tests, use disposable `mcp-smoke-*` records only.
- Check audit records when a tool call fails unexpectedly, is denied, or appears rate-limited.
- Rotate any token that may have appeared in terminal scrollback, logs, screenshots, issue trackers, or chat.

## Troubleshooting

- `401`: missing, invalid, expired, or revoked token.
- `403`: client lacks the scope for the tool.
- `409`: concurrency precondition failed or idempotency key was reused with a different payload.
- Missing preview URL: confirm the proposal includes a route where supported, such as `content.propose_update({ route })`.
- Draft cleanup failure: retry `blog.delete_mcp_draft` with the latest `expectedVersion`, or revoke the client and clean up through Cognito-authorized admin APIs.

## Runbook Pointers

- Current readiness and backlog:
  - `/Users/grayson/Desktop/Portfolio/design/mcp-integration/blog-authoring-mcp-readiness-audit.md`
- API gateway details:
  - `/Users/grayson/Desktop/Portfolio/redis-api-server/README.md`
- Authoring GUI operator flow:
  - `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/README.md`
