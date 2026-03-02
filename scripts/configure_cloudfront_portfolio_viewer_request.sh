#!/usr/bin/env bash
set -euo pipefail

# Ensures the portfolio CloudFront distribution has a LIVE viewer-request function
# that enforces apex -> www redirect and SPA route rewriting.
#
# Usage:
#   ./scripts/configure_cloudfront_portfolio_viewer_request.sh \
#     --distribution-id E28CZKZOGGZGVK \
#     --function-name gw-portfolio-viewer-request \
#     --function-file scripts/cloudfront-portfolio-viewer-request.js

DISTRIBUTION_ID=""
FUNCTION_NAME="gw-portfolio-viewer-request"
FUNCTION_FILE="scripts/cloudfront-portfolio-viewer-request.js"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --distribution-id)
      DISTRIBUTION_ID="$2"
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

if [[ -z "${DISTRIBUTION_ID}" ]]; then
  echo "Missing required argument: --distribution-id" >&2
  exit 1
fi

if [[ ! -f "${FUNCTION_FILE}" ]]; then
  echo "Function file not found: ${FUNCTION_FILE}" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }

echo "Ensuring CloudFront Function '${FUNCTION_NAME}' from ${FUNCTION_FILE}"

if aws cloudfront describe-function --name "${FUNCTION_NAME}" --stage DEVELOPMENT >/tmp/cf-fn-dev.json 2>/dev/null; then
  DEV_ETAG="$(jq -r '.ETag' /tmp/cf-fn-dev.json)"
  aws cloudfront update-function \
    --name "${FUNCTION_NAME}" \
    --if-match "${DEV_ETAG}" \
    --function-config "Comment=Portfolio apex redirect + SPA viewer-request handler,Runtime=cloudfront-js-1.0" \
    --function-code "fileb://${FUNCTION_FILE}" >/tmp/cf-fn-updated.json
else
  aws cloudfront create-function \
    --name "${FUNCTION_NAME}" \
    --function-config "Comment=Portfolio apex redirect + SPA viewer-request handler,Runtime=cloudfront-js-1.0" \
    --function-code "fileb://${FUNCTION_FILE}" >/tmp/cf-fn-updated.json
fi

PUBLISH_ETAG="$(jq -r '.ETag' /tmp/cf-fn-updated.json)"
aws cloudfront publish-function \
  --name "${FUNCTION_NAME}" \
  --if-match "${PUBLISH_ETAG}" >/tmp/cf-fn-live.json

FUNCTION_ARN="$(jq -r '.FunctionSummary.FunctionMetadata.FunctionARN' /tmp/cf-fn-live.json)"
if [[ -z "${FUNCTION_ARN}" || "${FUNCTION_ARN}" == "null" ]]; then
  echo "Unable to resolve LIVE function ARN for ${FUNCTION_NAME}" >&2
  exit 1
fi
echo "LIVE function ARN: ${FUNCTION_ARN}"

aws cloudfront get-distribution-config --id "${DISTRIBUTION_ID}" >/tmp/cf-dist.json
DIST_ETAG="$(jq -r '.ETag' /tmp/cf-dist.json)"

jq --arg fnArn "${FUNCTION_ARN}" '
  .DistributionConfig
  | .DefaultCacheBehavior.FunctionAssociations |= (
      (. // {"Quantity": 0, "Items": []})
      | .Items = ((.Items // []) | map(select(.EventType != "viewer-request")) + [{"EventType":"viewer-request","FunctionARN":$fnArn}])
      | .Quantity = (.Items | length)
    )
' /tmp/cf-dist.json >/tmp/cf-dist-updated.json

aws cloudfront update-distribution \
  --id "${DISTRIBUTION_ID}" \
  --if-match "${DIST_ETAG}" \
  --distribution-config file:///tmp/cf-dist-updated.json >/tmp/cf-dist-result.json

NEW_STATUS="$(jq -r '.Distribution.Status' /tmp/cf-dist-result.json)"
DOMAIN_NAME="$(jq -r '.Distribution.DomainName' /tmp/cf-dist-result.json)"
echo "Distribution update submitted: id=${DISTRIBUTION_ID} status=${NEW_STATUS} domain=${DOMAIN_NAME}"
echo "CloudFront propagation can take several minutes."
