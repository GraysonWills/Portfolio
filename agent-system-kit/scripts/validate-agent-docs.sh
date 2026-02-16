#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <docs-dir>"
  exit 1
fi

DOC_DIR="$1"
errors=0

require_file() {
  local file="$1"
  if [[ ! -f "${DOC_DIR}/${file}" ]]; then
    echo "missing file: ${DOC_DIR}/${file}"
    errors=$((errors + 1))
  fi
}

require_header() {
  local file="$1"
  local header="$2"
  if ! rg -q "^${header}$" "${DOC_DIR}/${file}"; then
    echo "missing header '${header}' in ${DOC_DIR}/${file}"
    errors=$((errors + 1))
  fi
}

require_file "plan.md"
require_file "agent.md"
require_file "subagent.md"

if [[ -f "${DOC_DIR}/plan.md" ]]; then
  require_header "plan.md" "# Plan"
  require_header "plan.md" "## Objective"
  require_header "plan.md" "## Acceptance Criteria"
fi

if [[ -f "${DOC_DIR}/agent.md" ]]; then
  require_header "agent.md" "# Agent"
  require_header "agent.md" "## Mission"
  require_header "agent.md" "## Quality Gates"
fi

if [[ -f "${DOC_DIR}/subagent.md" ]]; then
  require_header "subagent.md" "# Subagent"
  require_header "subagent.md" "## Task Boundary"
  require_header "subagent.md" "## Output Contract"
fi

if [[ "${errors}" -gt 0 ]]; then
  echo "validation failed (${errors} issue(s))"
  exit 1
fi

echo "validation passed"

