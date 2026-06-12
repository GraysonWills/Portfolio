#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-grayson-sso}"
REGION="${AWS_REGION:-us-east-2}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-portfolio-redis-api}"
LAMBDA_ALIAS="${LAMBDA_ALIAS:-live}"
PUBLISH_LIVE="${PUBLISH_LIVE:-true}"

PROVIDER_KEYS=(
  SOCIAL_X_CLIENT_ID
  SOCIAL_X_CLIENT_SECRET
  SOCIAL_LINKEDIN_CLIENT_ID
  SOCIAL_LINKEDIN_CLIENT_SECRET
  SOCIAL_META_CLIENT_ID
  SOCIAL_META_CLIENT_SECRET
)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

main() {
  require_cmd aws
  require_cmd jq

  local tmp_dir updated version
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  aws --profile "$PROFILE" --region "$REGION" lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'Environment.Variables' \
    --output json > "$tmp_dir/current-env.json"

  cp "$tmp_dir/current-env.json" "$tmp_dir/new-vars.json"
  updated=0

  for key in "${PROVIDER_KEYS[@]}"; do
    value="${!key:-}"
    if [ -z "$value" ]; then
      continue
    fi
    jq --arg k "$key" --arg v "$value" '.[$k] = $v' \
      "$tmp_dir/new-vars.json" > "$tmp_dir/next-vars.json"
    mv "$tmp_dir/next-vars.json" "$tmp_dir/new-vars.json"
    updated=$((updated + 1))
  done

  if [ "$updated" -eq 0 ]; then
    cat <<EOF
No provider credentials were supplied.

Set one or more of these environment variables and rerun:
  SOCIAL_X_CLIENT_ID
  SOCIAL_X_CLIENT_SECRET
  SOCIAL_LINKEDIN_CLIENT_ID
  SOCIAL_LINKEDIN_CLIENT_SECRET
  SOCIAL_META_CLIENT_ID
  SOCIAL_META_CLIENT_SECRET
EOF
    exit 1
  fi

  jq -n --slurpfile v "$tmp_dir/new-vars.json" '{Variables: $v[0]}' > "$tmp_dir/env-wrapper.json"

  aws --profile "$PROFILE" --region "$REGION" lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --environment "file://$tmp_dir/env-wrapper.json" \
    --query '{FunctionName:FunctionName,LastModified:LastModified,RevisionId:RevisionId}' \
    --output json
  aws --profile "$PROFILE" --region "$REGION" lambda wait function-updated \
    --function-name "$LAMBDA_FUNCTION_NAME"

  if [ "$PUBLISH_LIVE" = "true" ]; then
    version="$(aws --profile "$PROFILE" --region "$REGION" lambda publish-version \
      --function-name "$LAMBDA_FUNCTION_NAME" \
      --description "Social provider credential update" \
      --query 'Version' \
      --output text)"

    aws --profile "$PROFILE" --region "$REGION" lambda update-alias \
      --function-name "$LAMBDA_FUNCTION_NAME" \
      --name "$LAMBDA_ALIAS" \
      --function-version "$version" \
      --query '{Name:Name,FunctionVersion:FunctionVersion,RevisionId:RevisionId}' \
      --output json
  fi

  cat <<EOF
Social provider credentials updated without printing secret values.

Register these callback URLs in the provider apps:
  X/Twitter:   https://api.grayson-wills.com/api/social-auth/x/callback
  LinkedIn:    https://api.grayson-wills.com/api/social-auth/linkedin/callback
  Facebook:    https://api.grayson-wills.com/api/social-auth/facebook/callback
  Instagram:   https://api.grayson-wills.com/api/social-auth/instagram/callback
EOF
}

main "$@"
