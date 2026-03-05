# Website Platform Blueprint

This package captures the reusable **system setup** behind this portfolio stack so future websites can be built faster with the same proven structure.

It documents:
- Frontend/public site architecture
- Authoring/admin app architecture
- API/middleware/backend routing boundaries
- Content + subscriber data flow
- AWS deployment topology and CI/CD
- Security and operational controls
- Figma and mockup handoffs
- Minimal starter scaffold guidance (without locking you into legacy code)

## Scope

This is intentionally **not** a full code template. It is a blueprint for how to structure a modern static-frontend + API + authoring stack with secure content editing and email notifications.

## Package Map

1. `01-solution-architecture.md`
2. `02-routing-runtime-contracts.md`
3. `03-data-models-state.md`
4. `04-deployment-aws-cicd.md`
5. `05-security-ops-guardrails.md`
6. `06-figma-design-handoff.md`
7. `07-minimal-starter-skeleton.md`
8. `08-private-github-playbook.md`
9. `diagrams/*.mmd`
10. `scripts/create_private_blueprint_repo.sh`

## Source-of-Truth Refs In This Repo

- Frontend app: `/Users/grayson/Desktop/Portfolio/portfolio-app`
- Authoring app: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui`
- API server: `/Users/grayson/Desktop/Portfolio/redis-api-server`
- Existing design docs: `/Users/grayson/Desktop/Portfolio/design`
- CI/CD workflows: `/Users/grayson/Desktop/Portfolio/.github/workflows`

## How To Use For A New Project

1. Read `01` through `05` first.
2. Build your own brand and page map with `06`.
3. Start implementation using `07`.
4. Use `08` to create a private strategy/docs repo for your next project.

