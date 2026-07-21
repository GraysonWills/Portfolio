#!/usr/bin/env bash
set -euo pipefail

# Builds and deploys the Angular SSR renderer to a dedicated Lambda Function
# URL, then adds it to CloudFront with the existing S3 origin as 5xx fallback.
# Canary is the default. Add exact article paths with SSR_CANARY_PATHS.
# Set SSR_ROLLOUT=full only after canary verification.
#
# Example:
#   AWS_PROFILE=grayson-sso \
#   PUBLIC_EDGE_SHARED_SECRET=... \
#   INDEXNOW_KEY=... \
#   SSR_CANARY_PATHS='/blog,/blog/a-real-slug,/blog/another-real-slug' \
#   bash scripts/setup_portfolio_ssr.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/portfolio-app"
REGION="${AWS_REGION:-us-east-2}"
FUNCTION_NAME="${SSR_FUNCTION_NAME:-portfolio-ssr-renderer}"
ROLE_NAME="${SSR_ROLE_NAME:-portfolio-ssr-renderer-role}"
DIST_ID="${PUBLIC_CLOUDFRONT_DISTRIBUTION_ID:-E28CZKZOGGZGVK}"
BROWSER_BUCKET="${PORTFOLIO_BROWSER_BUCKET:-www.grayson-wills.com}"
ROLLOUT="${SSR_ROLLOUT:-canary}"
CANARY_PATHS="${SSR_CANARY_PATHS:-/blog}"
API_ORIGIN="${SSR_PUBLIC_API_ORIGIN:-https://www.grayson-wills.com}"
PUBLIC_EDGE_SHARED_SECRET="${PUBLIC_EDGE_SHARED_SECRET:-}"
INDEXNOW_KEY="${INDEXNOW_KEY:-}"
ORIGIN_SECRET="${SSR_ORIGIN_SHARED_SECRET:-}"
ORIGIN_SECRET_PARAMETER="${SSR_ORIGIN_SECRET_PARAMETER:-/portfolio/ssr/origin-shared-secret}"

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "zip not found" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl not found" >&2; exit 1; }

if [[ -z "${ORIGIN_SECRET}" ]]; then
  ORIGIN_SECRET="$(aws ssm get-parameter \
    --region "${REGION}" \
    --name "${ORIGIN_SECRET_PARAMETER}" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"
fi
if [[ -z "${ORIGIN_SECRET}" || "${ORIGIN_SECRET}" == "None" ]]; then
  ORIGIN_SECRET="$(openssl rand -hex 24)"
  aws ssm put-parameter \
    --region "${REGION}" \
    --name "${ORIGIN_SECRET_PARAMETER}" \
    --type SecureString \
    --value "${ORIGIN_SECRET}" \
    --overwrite >/dev/null
fi

if [[ "${SSR_SKIP_BUILD:-false}" != "true" ]]; then
  npm --prefix "${APP_DIR}" ci
  npm --prefix "${APP_DIR}" run build
fi

BROWSER_DIR="${APP_DIR}/dist/portfolio-app/browser"
SHELL_FILE="${BROWSER_DIR}/index.html"
if [[ ! -f "${SHELL_FILE}" ]]; then
  SHELL_FILE="${BROWSER_DIR}/index.csr.html"
fi
aws s3 sync "${BROWSER_DIR}/" "s3://${BROWSER_BUCKET}/" \
  --exclude "index.html" \
  --exclude "index.csr.html" \
  --exclude "favicon.ico" \
  --exclude "favicon.png" \
  --exclude "robots.txt" \
  --exclude "sitemap.xml" \
  --cache-control "public,max-age=31536000,immutable" >/dev/null
aws s3 cp "${SHELL_FILE}" "s3://${BROWSER_BUCKET}/index.html" \
  --cache-control "public,max-age=0,s-maxage=60,must-revalidate,stale-while-revalidate=300" \
  --content-type "text/html" >/dev/null
aws s3 cp "${BROWSER_DIR}/favicon.ico" "s3://${BROWSER_BUCKET}/favicon.ico" \
  --cache-control "public,max-age=86400,s-maxage=604800,stale-while-revalidate=86400" \
  --content-type "image/x-icon" >/dev/null
aws s3 cp "${BROWSER_DIR}/favicon.png" "s3://${BROWSER_BUCKET}/favicon.png" \
  --cache-control "public,max-age=86400,s-maxage=604800,stale-while-revalidate=86400" \
  --content-type "image/png" >/dev/null
aws s3 cp "${BROWSER_DIR}/robots.txt" "s3://${BROWSER_BUCKET}/robots.txt" \
  --cache-control "public,max-age=300,s-maxage=3600,stale-while-revalidate=86400" \
  --content-type "text/plain" >/dev/null
aws s3 cp "${BROWSER_DIR}/sitemap.xml" "s3://${BROWSER_BUCKET}/sitemap.xml" \
  --cache-control "public,max-age=300,s-maxage=3600,stale-while-revalidate=86400" \
  --content-type "application/xml" >/dev/null

PACKAGE_DIR="$(mktemp -d -t portfolio-ssr.XXXXXX)"
PACKAGE_FILE="${PACKAGE_DIR}/portfolio-ssr.zip"
trap 'rm -rf "${PACKAGE_DIR}"; rm -f "${CF_GET:-}" "${CF_CONFIG:-}"' EXIT
(cd "${APP_DIR}/dist/portfolio-app" && zip -qr "${PACKAGE_FILE}" browser server)

TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role --role-name "${ROLE_NAME}" --assume-role-policy-document "${TRUST_POLICY}" >/dev/null
  sleep 8
fi
aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
ROLE_ARN="$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)"

ENV_VARS="$(jq -nc \
  --arg api "${API_ORIGIN}" \
  --arg edge "${PUBLIC_EDGE_SHARED_SECRET}" \
  --arg origin "${ORIGIN_SECRET}" \
  --arg indexnow "${INDEXNOW_KEY}" \
  '{Variables:{
    NODE_ENV:"production",
    SSR_PUBLIC_API_ORIGIN:$api,
    PUBLIC_EDGE_SHARED_SECRET:$edge,
    SSR_ORIGIN_SHARED_SECRET:$origin,
    INDEXNOW_KEY:$indexnow
  }}')"

if aws lambda get-function --region "${REGION}" --function-name "${FUNCTION_NAME}" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --zip-file "fileb://${PACKAGE_FILE}" >/dev/null
  aws lambda wait function-updated --region "${REGION}" --function-name "${FUNCTION_NAME}"
  aws lambda update-function-configuration \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs22.x \
    --handler server/server.handler \
    --timeout 30 \
    --memory-size 1536 \
    --environment "${ENV_VARS}" >/dev/null
else
  aws lambda create-function \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs22.x \
    --role "${ROLE_ARN}" \
    --handler server/server.handler \
    --timeout 30 \
    --memory-size 1536 \
    --architectures x86_64 \
    --zip-file "fileb://${PACKAGE_FILE}" \
    --environment "${ENV_VARS}" >/dev/null
fi
aws lambda wait function-active-v2 --region "${REGION}" --function-name "${FUNCTION_NAME}"

if ! aws lambda get-function-url-config --region "${REGION}" --function-name "${FUNCTION_NAME}" >/dev/null 2>&1; then
  aws lambda create-function-url-config \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --auth-type NONE >/dev/null
fi
aws lambda add-permission \
  --region "${REGION}" \
  --function-name "${FUNCTION_NAME}" \
  --statement-id PublicFunctionUrl \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission \
  --region "${REGION}" \
  --function-name "${FUNCTION_NAME}" \
  --statement-id PublicFunctionInvokeViaUrl \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url >/dev/null 2>&1 || true

FUNCTION_URL="$(aws lambda get-function-url-config --region "${REGION}" --function-name "${FUNCTION_NAME}" --query FunctionUrl --output text)"
FUNCTION_HOST="$(sed -E 's#^https?://([^/]+)/?.*$#\1#' <<< "${FUNCTION_URL}")"

SSR_CACHE_POLICY_NAME="${SSR_CACHE_POLICY_NAME:-portfolio-ssr-route-cache}"
SSR_CACHE_POLICY_ID="$(aws cloudfront list-cache-policies \
  --type custom \
  --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='${SSR_CACHE_POLICY_NAME}'] | [0].CachePolicy.Id" \
  --output text)"
if [[ -z "${SSR_CACHE_POLICY_ID}" || "${SSR_CACHE_POLICY_ID}" == "None" ]]; then
  SSR_CACHE_POLICY_CONFIG="$(jq -nc --arg name "${SSR_CACHE_POLICY_NAME}" '{
    Name: $name,
    Comment: "Cache SSR HTML by the original viewer URI and query string",
    DefaultTTL: 300,
    MaxTTL: 86400,
    MinTTL: 0,
    ParametersInCacheKeyAndForwardedToOrigin: {
      EnableAcceptEncodingGzip: true,
      EnableAcceptEncodingBrotli: true,
      HeadersConfig: {
        HeaderBehavior: "whitelist",
        Headers: {Quantity: 1, Items: ["x-portfolio-original-uri"]}
      },
      CookiesConfig: {CookieBehavior: "none"},
      QueryStringsConfig: {QueryStringBehavior: "all"}
    }
  }')"
  SSR_CACHE_POLICY_ID="$(aws cloudfront create-cache-policy \
    --cache-policy-config "${SSR_CACHE_POLICY_CONFIG}" \
    --query 'CachePolicy.Id' \
    --output text)"
fi

CF_GET="$(mktemp)"
CF_CONFIG="$(mktemp)"
aws cloudfront get-distribution-config --id "${DIST_ID}" --output json > "${CF_GET}"
ETAG="$(jq -r '.ETag' "${CF_GET}")"
jq '.DistributionConfig' "${CF_GET}" > "${CF_CONFIG}"

SSR_ORIGIN_ID='portfolio-ssr-lambda-url'
SSR_GROUP_ID='portfolio-ssr-with-s3-fallback'
S3_ORIGIN_ID="$(jq -r '.DefaultCacheBehavior.TargetOriginId as $default | (.Origins.Items[] | select(.Id == $default and .S3OriginConfig != null) | .Id) // (.Origins.Items[] | select(.S3OriginConfig != null) | .Id)' "${CF_CONFIG}" | head -1)"
if [[ -z "${S3_ORIGIN_ID}" || "${S3_ORIGIN_ID}" == "null" ]]; then
  echo "Unable to identify the existing S3 fallback origin" >&2
  exit 1
fi

IFS=',' read -r -a CANARY_ARRAY <<< "${CANARY_PATHS}"
CANARY_JSON="$(printf '%s\n' "${CANARY_ARRAY[@]}" | jq -R 'gsub("^ +| +$"; "") | sub("^/"; "") | select(length > 0)' | jq -s '.')"

jq \
  --arg ssrOrigin "${SSR_ORIGIN_ID}" \
  --arg ssrGroup "${SSR_GROUP_ID}" \
  --arg s3Origin "${S3_ORIGIN_ID}" \
  --arg functionHost "${FUNCTION_HOST}" \
  --arg originSecret "${ORIGIN_SECRET}" \
  --arg rollout "${ROLLOUT}" \
  --arg ssrCachePolicy "${SSR_CACHE_POLICY_ID}" \
  --argjson canary "${CANARY_JSON}" '
    .Origins.Items = ((.Origins.Items // []) | map(select(.Id != $ssrOrigin)) + [{
      Id: $ssrOrigin,
      DomainName: $functionHost,
      OriginPath: "",
      CustomHeaders: {Quantity: 1, Items: [{HeaderName:"x-portfolio-ssr-secret", HeaderValue:$originSecret}]},
      CustomOriginConfig: {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: "https-only",
        OriginSslProtocols: {Quantity:1, Items:["TLSv1.2"]},
        OriginReadTimeout: 30,
        OriginKeepaliveTimeout: 5
      },
      ConnectionAttempts: 2,
      ConnectionTimeout: 5,
      OriginShield: {Enabled:false},
      OriginAccessControlId: ""
    }])
    | .Origins.Quantity = (.Origins.Items | length)
    | .OriginGroups = (.OriginGroups // {Quantity:0, Items:[]})
    | .OriginGroups.Items = ((.OriginGroups.Items // []) | map(select(.Id != $ssrGroup)) + [{
      Id: $ssrGroup,
      FailoverCriteria: {StatusCodes:{Quantity:4, Items:[500,502,503,504]}},
      Members:{Quantity:2, Items:[{OriginId:$ssrOrigin},{OriginId:$s3Origin}]}
    }])
    | .OriginGroups.Quantity = (.OriginGroups.Items | length)
    | (.DefaultCacheBehavior) as $base
    | .CacheBehaviors = (.CacheBehaviors // {Quantity:0, Items:[]})
    | .CacheBehaviors.Items = (
        (.CacheBehaviors.Items // [])
        | map(select((.PathPattern as $p | ($canary + ["sitemap.xml","rss.xml","feed.json","llms.txt","robots.txt"] | index($p))) == null))
        + (($canary + ["sitemap.xml","rss.xml","feed.json","llms.txt","robots.txt"]) | map(
            ($base + {PathPattern: ., TargetOriginId:$ssrGroup, CachePolicyId:$ssrCachePolicy, Compress:true})
          ))
      )
    | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
    | if $rollout == "full" then
        .DefaultCacheBehavior.TargetOriginId = $ssrGroup
        | .DefaultCacheBehavior.CachePolicyId = $ssrCachePolicy
        | .CacheBehaviors.Items += (["*.js","*.css","*.map","*.png","*.jpg","*.jpeg","*.webp","*.svg","*.ico","*.woff","*.woff2","*.ttf","*.eot","*.docx","*.pdf","assets/*","uploads/*"] | map(
            ($base + {PathPattern: ., TargetOriginId:$s3Origin, Compress:true})
          ))
        | .CacheBehaviors.Items |= unique_by(.PathPattern)
        | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
      else . end
  ' "${CF_CONFIG}" > "${CF_CONFIG}.next"
mv "${CF_CONFIG}.next" "${CF_CONFIG}"

aws cloudfront update-distribution \
  --id "${DIST_ID}" \
  --if-match "${ETAG}" \
  --distribution-config "file://${CF_CONFIG}" >/dev/null

echo "SSR Lambda deployed: ${FUNCTION_NAME}"
echo "Function URL: ${FUNCTION_URL}"
echo "CloudFront rollout: ${ROLLOUT}"
echo "Canary paths: ${CANARY_PATHS}"
echo "CloudFront distribution update is in progress."
echo "Origin secret is stored in SSM SecureString ${ORIGIN_SECRET_PARAMETER}."
