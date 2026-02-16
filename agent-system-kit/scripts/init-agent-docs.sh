#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <target-dir>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/../templates"
TARGET_DIR="$1"

mkdir -p "${TARGET_DIR}"

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -e "${dest}" ]]; then
    echo "skip: ${dest} (already exists)"
  else
    cp "${src}" "${dest}"
    echo "create: ${dest}"
  fi
}

copy_if_missing "${TEMPLATE_DIR}/plan.md" "${TARGET_DIR}/plan.md"
copy_if_missing "${TEMPLATE_DIR}/agent.md" "${TARGET_DIR}/agent.md"
copy_if_missing "${TEMPLATE_DIR}/subagent.md" "${TARGET_DIR}/subagent.md"
copy_if_missing "${TEMPLATE_DIR}/handoff.md" "${TARGET_DIR}/handoff.md"
copy_if_missing "${TEMPLATE_DIR}/decision-log.md" "${TARGET_DIR}/decision-log.md"

