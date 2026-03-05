#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-website-platform-blueprint}"
OWNER="${2:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLUEPRINT_DIR="${ROOT_DIR}/platform-blueprint"
DESIGN_DIR="${ROOT_DIR}/design"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if [[ ! -d "${BLUEPRINT_DIR}" ]]; then
  echo "Blueprint directory not found: ${BLUEPRINT_DIR}" >&2
  exit 1
fi

if [[ -z "${OWNER}" ]]; then
  OWNER="$(gh api user -q .login)"
fi

FULL_REPO="${OWNER}/${REPO_NAME}"

if gh repo view "${FULL_REPO}" >/dev/null 2>&1; then
  echo "Repository already exists: ${FULL_REPO}" >&2
  echo "Choose a different name." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

mkdir -p "${WORKDIR}/platform-blueprint"
cp -R "${BLUEPRINT_DIR}/." "${WORKDIR}/platform-blueprint/"

# Include design artifacts (docs + mockups) without full app code.
mkdir -p "${WORKDIR}/design"
if [[ -d "${DESIGN_DIR}/ux-overhaul" ]]; then
  cp -R "${DESIGN_DIR}/ux-overhaul" "${WORKDIR}/design/"
fi
if [[ -d "${DESIGN_DIR}/email-notifications" ]]; then
  cp -R "${DESIGN_DIR}/email-notifications" "${WORKDIR}/design/"
fi
if [[ -d "${DESIGN_DIR}/bedrock" ]]; then
  cp -R "${DESIGN_DIR}/bedrock" "${WORKDIR}/design/"
fi
if [[ -d "${DESIGN_DIR}/mcp-integration" ]]; then
  cp -R "${DESIGN_DIR}/mcp-integration" "${WORKDIR}/design/"
fi

cat > "${WORKDIR}/README.md" <<README
# ${REPO_NAME}

Private architecture and process blueprint for building website platforms based on the portfolio stack.

## Contents

- \`platform-blueprint/\` system architecture, contracts, deployment, and security playbooks
- \`design/\` reusable UX + email notification handoffs and mockups

Generated from: ${ROOT_DIR}
README

pushd "${WORKDIR}" >/dev/null

git init -b main >/dev/null
git add .
git commit -m "Initialize private website platform blueprint" >/dev/null

gh repo create "${FULL_REPO}" --private --source . --remote origin --push >/dev/null

REPO_URL="$(gh repo view "${FULL_REPO}" --json url -q .url)"
echo "Created private repo: ${REPO_URL}"

popd >/dev/null
