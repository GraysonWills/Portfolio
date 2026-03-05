# 07. Minimal Starter Skeleton (Low-Code-Lock-In)

This starter is intentionally thin. It gives structure and contracts without forcing legacy implementation choices.

## Recommended Repository Layout

```text
website-project/
  apps/
    public-site/          # frontend (read-only UX)
    authoring-console/    # frontend (authenticated write UX)
  services/
    content-api/          # routing, middleware, integration logic
  infra/
    aws/                  # IaC, env wiring, deploy docs
  docs/
    architecture/
    runbooks/
  .github/
    workflows/
```

## Required Contracts Before Coding

1. Route contracts:
   - public routes
   - authoring routes
   - API endpoint map
2. Data contracts:
   - content schema
   - metadata conventions
   - subscriber schema (if email)
3. Security contracts:
   - auth boundaries
   - write endpoint policies
   - rate-limit baseline
4. Deploy contracts:
   - environment matrix (local/stage/prod)
   - smoke tests
   - rollback process

## Minimal Starter Artifacts To Keep

Only keep these reusable assets:
- API route map template
- Data dictionary template
- Environment variable matrix template
- CI deploy workflow skeleton
- Smoke-test skeleton

Avoid carrying old business code into new projects unless it is clearly reusable.

## Suggested First Milestones

1. Lock route + schema contracts in docs.
2. Wire public site read path end-to-end.
3. Wire authoring write path end-to-end.
4. Add auth + security limits.
5. Add deployment automation + smoke tests.

