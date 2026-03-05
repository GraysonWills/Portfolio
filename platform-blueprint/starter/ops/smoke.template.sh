#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-https://example.com}"
API_URL="${API_URL:-https://api.example.com/api}"

code() { curl -sS -o /dev/null -w '%{http_code}' "$1" || true; }

[[ "$(code "${SITE_URL}/")" == "200" ]]
[[ "$(code "${SITE_URL}/robots.txt")" == "200" ]]
[[ "$(code "${API_URL}/health")" == "200" ]]

echo "OK"
