#!/usr/bin/env bash
set -euo pipefail

# Production smoke tests for the deployed stack.
# Intended for CI runners (GitHub Actions) and local verification.

PORTFOLIO_URL="${PORTFOLIO_URL:-https://www.grayson-wills.com}"
APEX_URL="${APEX_URL:-https://grayson-wills.com}"
BLOG_URL="${BLOG_URL:-https://d39s45clv1oor3.cloudfront.net}"
API_URL="${API_URL:-https://api.grayson-wills.com/api}"

S3_WWW_URL="${S3_WWW_URL:-https://s3.us-east-2.amazonaws.com/www.grayson-wills.com/index.html}"
S3_BLOG_URL="${S3_BLOG_URL:-https://s3.us-east-2.amazonaws.com/grayson-wills-blog-authoring-dev-381492289909/index.html}"

retry() {
  local attempts="${1:-20}"
  local sleep_s="${2:-10}"
  shift 2 || true

  local i=1
  until "$@"; do
    if [[ "$i" -ge "$attempts" ]]; then
      echo "FAILED: $*"
      return 1
    fi
    echo "retry $i/$attempts: $*"
    i=$((i + 1))
    sleep "$sleep_s"
  done
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$1" || true
}

expect_code() {
  local url="$1"
  local expected="$2"
  local got
  got="$(http_code "$url")"
  if [[ "$got" != "$expected" ]]; then
    echo "expected $expected, got $got: $url"
    return 1
  fi
}

expect_redirect_location() {
  local url="$1"
  local expected_location="$2"
  local location
  location="$(curl -sS -I "$url" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r' | tail -n 1)"
  if [[ "$location" != "$expected_location" ]]; then
    echo "expected location '$expected_location', got '$location': $url"
    return 1
  fi
}

expect_json_array_len_gt() {
  local url="$1"
  local min="$2"
  local len
  len="$(curl -sS "$url" | jq 'length' 2>/dev/null || echo -1)"
  if [[ "$len" -le "$min" ]]; then
    echo "expected array length > $min, got $len: $url"
    return 1
  fi
}

expect_cors_allow_origin() {
  local url="$1"
  local origin="$2"
  local allow
  allow="$(curl -sS -D - -o /dev/null -H "Origin: ${origin}" "$url" | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}' | tr -d '\r' | tail -n 1)"
  if [[ "$allow" != "$origin" ]]; then
    echo "expected ACAO '$origin', got '$allow': $url"
    return 1
  fi
}

expect_content_type_prefix() {
  local url="$1"
  local expected_prefix="$2"
  local got
  got="$(curl -sS -I "$url" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r' | tail -n 1)"
  if [[ "$got" != "${expected_prefix}"* ]]; then
    echo "expected content-type starting with '${expected_prefix}', got '${got}': $url"
    return 1
  fi
}

echo "== Static sites =="
retry 30 10 expect_code "${PORTFOLIO_URL}/" "200"
retry 30 10 expect_code "${PORTFOLIO_URL}/this/does/not/exist" "200"
retry 30 10 expect_code "${BLOG_URL}/" "200"
retry 30 10 expect_code "${BLOG_URL}/content-studio" "200"

echo "== SEO files =="
retry 30 10 expect_code "${PORTFOLIO_URL}/robots.txt" "200"
retry 30 10 expect_content_type_prefix "${PORTFOLIO_URL}/robots.txt" "text/plain"
retry 30 10 expect_code "${PORTFOLIO_URL}/sitemap.xml" "200"
retry 30 10 expect_content_type_prefix "${PORTFOLIO_URL}/sitemap.xml" "application/xml"

echo "== Apex redirect =="
retry 30 10 expect_code "${APEX_URL}/" "301"
retry 30 10 expect_redirect_location "${APEX_URL}/some/path?x=1" "https://www.grayson-wills.com/some/path?x=1"

echo "== API =="
retry 30 10 expect_code "${API_URL}/health" "200"
retry 30 10 expect_json_array_len_gt "${API_URL}/content" 0
retry 30 10 expect_code "http://api.grayson-wills.com/api/health" "301"

echo "== Authz sanity (writes must be protected) =="
unauth_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/content" -H 'Content-Type: application/json' -d '{}' || true)"
if [[ "$unauth_code" != "401" ]]; then
  echo "expected 401 on unauthenticated POST /content, got ${unauth_code}"
  exit 1
fi

echo "== CORS =="
retry 30 10 expect_cors_allow_origin "${API_URL}/content" "https://www.grayson-wills.com"
retry 30 10 expect_cors_allow_origin "${API_URL}/content" "https://d39s45clv1oor3.cloudfront.net"

echo "== S3 direct access should be blocked (private buckets) =="
retry 30 10 expect_code "${S3_WWW_URL}" "403"
retry 30 10 expect_code "${S3_BLOG_URL}" "403"

echo "OK"
