# Mesh → back-of-shop publishing contract

Status: social delivery implemented and hardened 2026-07-13; ADR-027 selected
the canonical blog draft plus auto-executed exact schedule request on 2026-07-15.

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

## Blog scheduling

After an exact Mesh `blog_draft` decision, Mesh uploads the selected image (or
records the explicit no-image choice), calls `blog.create_draft`, then calls
`blog.request_schedule` with the human-selected instant. The dedicated Mesh
client must carry `blog:read`, `blog:write:draft`, `media:write:draft`, and
`blog:propose`, and its auto-execute allowlist contains only the required
`blog.request_schedule` action. Both calls use stable effect-derived
idempotency keys; a non-auto-executed schedule response is a configuration
failure, not success.

`blog.get_post` and `blog.list_posts` return a canonical `publicUrl`. Mesh
treats `status=published` plus that URL and a timezone-aware `publishDate` as
publication evidence. Until all three are present, its effect remains
scheduled and no `content.published` event is emitted.

## Hidden Collections projection

`collections.create_entry` requires the non-default
`collections:write:hidden` scope. It accepts only `visibility=hidden`, derives
a stable entry identity from the owner and Mesh source reference, returns the
same record for an identical replay, and rejects attempts to rewrite that
source in place. This tool is called only after the exact `audio_routing` gate;
it cannot make a Collection public.
