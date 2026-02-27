#!/usr/bin/env bash
set -euo pipefail

# One-time CloudFront SPA routing hardening:
# - associates a viewer-request CloudFront Function that rewrites only extensionless routes to /index.html
# - disables CustomErrorResponses fallback that rewrites missing asset paths to HTML
#
# Usage:
#   ./scripts/configure_cloudfront_spa_rewrite.sh \
#     --distribution-id E28CZKZOGGZGVK \
#     --distribution-id E31OPQLJ4WFI66 \
#     --function-name gw-spa-route-rewrite \
#     --function-file scripts/cloudfront-spa-viewer-request.js

FUNCTION_NAME="gw-spa-route-rewrite"
FUNCTION_FILE="scripts/cloudfront-spa-viewer-request.js"
declare -a DISTRIBUTION_IDS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --distribution-id)
      DISTRIBUTION_IDS+=("$2")
      shift 2
      ;;
    --function-name)
      FUNCTION_NAME="$2"
      shift 2
      ;;
    --function-file)
      FUNCTION_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${#DISTRIBUTION_IDS[@]} -eq 0 ]]; then
  echo "Provide at least one --distribution-id" >&2
  exit 1
fi

if [[ ! -f "$FUNCTION_FILE" ]]; then
  echo "Function file not found: $FUNCTION_FILE" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }

echo "Checking CloudFront Function: $FUNCTION_NAME"

if aws cloudfront describe-function --name "$FUNCTION_NAME" --stage DEVELOPMENT >/tmp/cf-fn-dev.json 2>/dev/null; then
  DEV_ETAG="$(jq -r '.ETag' /tmp/cf-fn-dev.json)"
  aws cloudfront update-function \
    --name "$FUNCTION_NAME" \
    --if-match "$DEV_ETAG" \
    --function-config "Comment=SPA route rewrite for extensionless paths,Runtime=cloudfront-js-1.0" \
    --function-code "fileb://${FUNCTION_FILE}" >/tmp/cf-fn-updated.json
else
  aws cloudfront create-function \
    --name "$FUNCTION_NAME" \
    --function-config "Comment=SPA route rewrite for extensionless paths,Runtime=cloudfront-js-1.0" \
    --function-code "fileb://${FUNCTION_FILE}" >/tmp/cf-fn-updated.json
fi

PUBLISH_ETAG="$(jq -r '.ETag' /tmp/cf-fn-updated.json)"
aws cloudfront publish-function \
  --name "$FUNCTION_NAME" \
  --if-match "$PUBLISH_ETAG" >/tmp/cf-fn-live.json

FUNCTION_ARN="$(jq -r '.FunctionSummary.FunctionMetadata.FunctionARN' /tmp/cf-fn-live.json)"
if [[ -z "$FUNCTION_ARN" || "$FUNCTION_ARN" == "null" ]]; then
  echo "Unable to resolve LIVE function ARN" >&2
  exit 1
fi

echo "Published function ARN: $FUNCTION_ARN"

for DIST_ID in "${DISTRIBUTION_IDS[@]}"; do
  echo "Updating distribution: $DIST_ID"
  aws cloudfront get-distribution-config --id "$DIST_ID" >/tmp/cf-dist.json
  DIST_ETAG="$(jq -r '.ETag' /tmp/cf-dist.json)"

  jq --arg fnArn "$FUNCTION_ARN" '
    .DistributionConfig
    | .DefaultCacheBehavior.FunctionAssociations |= (
        (. // {"Quantity": 0, "Items": []})
        | .Items = ((.Items // []) | map(select(.EventType != "viewer-request")) + [{"EventType":"viewer-request","FunctionARN":$fnArn}])
        | .Quantity = (.Items | length)
      )
    | .CustomErrorResponses = {"Quantity": 0}
  ' /tmp/cf-dist.json >/tmp/cf-dist-updated.json

  aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --if-match "$DIST_ETAG" \
    --distribution-config file:///tmp/cf-dist-updated.json >/tmp/cf-dist-result.json

  NEW_STATUS="$(jq -r '.Distribution.Status' /tmp/cf-dist-result.json)"
  DOMAIN_NAME="$(jq -r '.Distribution.DomainName' /tmp/cf-dist-result.json)"
  echo "Distribution updated: $DIST_ID status=${NEW_STATUS} domain=${DOMAIN_NAME}"
done

echo "Done. CloudFront may take several minutes to fully propagate."
