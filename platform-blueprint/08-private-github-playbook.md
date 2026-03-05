# 08. Private GitHub Playbook

Use this to keep architecture/process IP private while still reusing the setup for future websites.

## What Goes In The Private Repo

Recommended:
- `/platform-blueprint/*` from this repo
- design handoff docs + mockups from:
  - `/Users/grayson/Desktop/Portfolio/design/ux-overhaul`
  - `/Users/grayson/Desktop/Portfolio/design/email-notifications`

Avoid copying full production code unless needed for a specific reusable module.

## One-Command Bootstrap

Script:
- `/Users/grayson/Desktop/Portfolio/platform-blueprint/scripts/create_private_blueprint_repo.sh`

Usage:

```bash
cd /Users/grayson/Desktop/Portfolio
./platform-blueprint/scripts/create_private_blueprint_repo.sh <repo-name> [owner]
```

Example:

```bash
./platform-blueprint/scripts/create_private_blueprint_repo.sh website-platform-blueprint
```

## Access Control Recommendations

1. Keep repo private.
2. Grant explicit collaborator/team access only.
3. Protect `main` branch (PRs + checks required).
4. Enable secret scanning and Dependabot alerts.
5. Keep architecture docs current after each major release.

## Suggested Maintenance Routine

- After each major platform change, update:
  - routing contracts
  - data contracts
  - deploy runbook
  - threat/risk controls
  - design handoff docs

