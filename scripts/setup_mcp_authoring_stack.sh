#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-grayson-sso}"
REGION="${AWS_REGION:-us-east-2}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-portfolio-redis-api}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-PortfolioRedisApiLambdaRole}"
LAMBDA_ROLE_POLICY_NAME="${LAMBDA_ROLE_POLICY_NAME:-PortfolioRedisApiLambdaPolicy}"
MCP_CONTROL_TABLE_NAME="${MCP_CONTROL_TABLE_NAME:-portfolio-mcp-control}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

upsert_inline_policy_statement() {
  local sid="$1"
  local statement="$2"
  local tmp current merged
  tmp="$(mktemp)"

  if aws --profile "$PROFILE" --region "$REGION" iam get-role-policy \
    --role-name "$LAMBDA_ROLE_NAME" \
    --policy-name "$LAMBDA_ROLE_POLICY_NAME" \
    --query PolicyDocument \
    --output json >"$tmp" 2>/dev/null; then
    current="$(cat "$tmp")"
  else
    current='{"Version":"2012-10-17","Statement":[]}'
  fi

  merged="$(jq -c --arg sid "$sid" --argjson stmt "$statement" '
    .Statement = ((.Statement // []) | map(select(.Sid != $sid)) + [$stmt])
  ' <<<"$current")"

  aws --profile "$PROFILE" --region "$REGION" iam put-role-policy \
    --role-name "$LAMBDA_ROLE_NAME" \
    --policy-name "$LAMBDA_ROLE_POLICY_NAME" \
    --policy-document "$merged" >/dev/null

  rm -f "$tmp"
}

ensure_table() {
  if aws --profile "$PROFILE" --region "$REGION" dynamodb describe-table --table-name "$MCP_CONTROL_TABLE_NAME" >/dev/null 2>&1; then
    echo "DynamoDB table already exists: $MCP_CONTROL_TABLE_NAME"
  else
    aws --profile "$PROFILE" --region "$REGION" dynamodb create-table \
      --table-name "$MCP_CONTROL_TABLE_NAME" \
      --billing-mode PAY_PER_REQUEST \
      --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
      --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE >/dev/null
    aws --profile "$PROFILE" --region "$REGION" dynamodb wait table-exists --table-name "$MCP_CONTROL_TABLE_NAME"
    echo "Created DynamoDB table: $MCP_CONTROL_TABLE_NAME"
  fi

  aws --profile "$PROFILE" --region "$REGION" dynamodb update-time-to-live \
    --table-name "$MCP_CONTROL_TABLE_NAME" \
    --time-to-live-specification Enabled=true,AttributeName=expiresAtEpoch >/dev/null 2>&1 || true
}

ensure_iam() {
  local account_id table_arn statement
  account_id="$(aws --profile "$PROFILE" --region "$REGION" sts get-caller-identity --query Account --output text)"
  table_arn="arn:aws:dynamodb:${REGION}:${account_id}:table/${MCP_CONTROL_TABLE_NAME}"
  statement="$(jq -nc --arg arn "$table_arn" '{
    Sid: "DynamoDbMcpControl",
    Effect: "Allow",
    Action: [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem"
    ],
    Resource: $arn
  }')"
  upsert_inline_policy_statement "DynamoDbMcpControl" "$statement"
}

ensure_lambda_env() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  aws --profile "$PROFILE" --region "$REGION" lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'Environment.Variables' \
    --output json > "$tmp_dir/current-env.json"

  jq --arg table "$MCP_CONTROL_TABLE_NAME" '
    (. // {}) + {
      MCP_CONTROL_TABLE_NAME: $table
    }
  ' "$tmp_dir/current-env.json" > "$tmp_dir/new-vars.json"
  jq -n --slurpfile v "$tmp_dir/new-vars.json" '{Variables: $v[0]}' > "$tmp_dir/env-wrapper.json"

  aws --profile "$PROFILE" --region "$REGION" lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --environment "file://$tmp_dir/env-wrapper.json" >/dev/null
  aws --profile "$PROFILE" --region "$REGION" lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME"

  rm -rf "$tmp_dir"
}

main() {
  require_cmd aws
  require_cmd jq
  ensure_table
  ensure_iam
  ensure_lambda_env

  cat <<EOF
MCP authoring control plane is ready.

Created/reused:
  DynamoDB table: ${MCP_CONTROL_TABLE_NAME}
  Lambda env:     MCP_CONTROL_TABLE_NAME=${MCP_CONTROL_TABLE_NAME}

Token hashing uses MCP_TOKEN_HASH_SECRET when set, otherwise the existing
SOCIAL_AUTH_TOKEN_SECRET/TOKEN_ENCRYPTION_SECRET fallback.
EOF
}

main "$@"
