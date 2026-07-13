# Mesh → back-of-shop publishing contract

Status: social delivery implemented and hardened 2026-07-13; blog publishing
contract still requires an ADR decision.

## Trust boundary

The mesh is an event-driven worker pipeline, not an autonomous agent. A call to
the direct-send tool is valid only after Mission Control has recorded Grayson's
approval for that exact effect. The Portfolio MCP client used by the mesh must
have the narrowly scoped `social:write:send` permission; that scope is never a
default. The MCP token belongs in `.env`/the runtime secret store and must not
be committed or written to logs.

## Social delivery

Tool: `social.schedule_delivery`

Required inputs:

- `provider`
- `caption`
- `idempotencyKey` — a stable identity derived from the approved mesh effect

Optional media and link fields are part of the idempotency payload. Reusing a
key with changed content is a `409` error.

The back-of-shop derives one deterministic delivery ID from MCP client, tool,
and idempotency key. DynamoDB conditionally creates that delivery record before
the provider call, then conditionally moves it to `sending`. Consequently:

- concurrent calls cannot both acquire the send;
- a completed `sent` delivery is returned even when the caller retries with
  `force`;
- a provider or persistence failure after send begins becomes `unknown`;
- `sending` and `unknown` deliveries refuse automatic retry and require human
  reconciliation;
- `sent`, `sending`, and `unknown` delivery records cannot be deleted through
  the normal API, preserving the replay receipt and reconciliation evidence;
- an unconfigured provider remains `failed` and can be retried safely after
  its credential is repaired;
- the MCP tool succeeds only when the delivery state is `sent`.

This is deliberately at-most-once at the final provider boundary when the
provider itself has no idempotency primitive. Availability is traded for
duplicate prevention in ambiguous outcomes.

## Reconciliation runbook

1. Open the Distribution queue and locate the delivery ID from the mesh/MCP
   error or audit record.
2. Check the provider account for a matching post before changing any state.
3. If the post exists, record its provider ID/URL and mark the delivery sent.
4. If the post definitely does not exist, reset the delivery to `failed` and
   retry with the same idempotency key.
5. Never mint a new key merely to bypass `sending` or `unknown`; that authorizes
   a second public effect.

## Blog publishing decision still open

The mesh blog publisher still targets the development stub shape
`POST /api/posts`. Production Portfolio writes are canonical at
`/api/blog/posts` and require a Cognito user token; the existing machine MCP
surface separates `blog.create_draft` from approval-backed
`blog.request_publish`. Bridging these without either bypassing a gate or
adding a redundant one is a contract/approval decision, not a compatibility
alias to add silently.

ADR options:

1. Use `blog.create_draft` plus `blog.request_publish`, and configure only the
   mesh client to auto-execute publish requests after the upstream Grayson
   gate. This reuses canonical services and preserves an executed approval
   audit record, but requires two replay-safe calls and client policy setup.
2. Add a narrowly scoped `blog.publish_preapproved` MCP tool. This is simpler
   for the mesh and mirrors social delivery, but creates a second privileged
   direct-publish surface and needs a new non-default scope.
3. Add a machine-authenticated HTTP compatibility endpoint. This matches the
   current worker with the smallest mesh diff, but duplicates MCP auth,
   auditing, rate limiting, and idempotency policy.

Recommendation: option 1. It reuses the existing canonical post and
notification paths, keeps one machine credential, and leaves an AWS-side audit
record explaining why publication was allowed. Implement it only after the
approval-policy ADR is accepted.
