#!/usr/bin/env bash
set -euo pipefail

# Provisions photo asset storage architecture:
# - S3 for binaries
# - DynamoDB for metadata/indexing
# - IAM permissions for ECS API task role

PROFILE="${AWS_PROFILE:-grayson-sso}"
REGION="${AWS_REGION:-us-east-2}"
ACCOUNT_ID="$(aws --profile "$PROFILE" sts get-caller-identity --query 'Account' --output text)"

PHOTO_BUCKET="${PHOTO_BUCKET:-grayson-wills-media-${ACCOUNT_ID}}"
PHOTO_PREFIX="$(echo "${PHOTO_PREFIX:-photo-assets/}" | sed 's#^/*##; s#/*$#/#')"
PHOTO_TABLE_NAME="${PHOTO_TABLE_NAME:-portfolio-photo-assets}"
TASK_ROLE_NAME="${TASK_ROLE_NAME:-PortfolioRedisApiTaskRole}"
TASK_ROLE_POLICY_NAME="${TASK_ROLE_POLICY_NAME:-PortfolioRedisApiS3Uploads}"

log() { echo "[photo-assets-setup] $*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws
require_cmd jq

create_bucket_if_missing() {
  if aws --profile "$PROFILE" --region "$REGION" s3api head-bucket --bucket "$PHOTO_BUCKET" >/dev/null 2>&1; then
    log "S3 bucket exists: $PHOTO_BUCKET"
    return
  fi

  log "Creating S3 bucket: $PHOTO_BUCKET"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws --profile "$PROFILE" --region "$REGION" s3api create-bucket --bucket "$PHOTO_BUCKET" >/dev/null
  else
    aws --profile "$PROFILE" --region "$REGION" s3api create-bucket \
      --bucket "$PHOTO_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
}

secure_bucket() {
  log "Applying encryption + ownership controls + public access block + CORS + lifecycle to $PHOTO_BUCKET"
  aws --profile "$PROFILE" --region "$REGION" s3api put-bucket-encryption \
    --bucket "$PHOTO_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null

  aws --profile "$PROFILE" --region "$REGION" s3api put-bucket-ownership-controls \
    --bucket "$PHOTO_BUCKET" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]' >/dev/null

  aws --profile "$PROFILE" --region "$REGION" s3api put-public-access-block \
    --bucket "$PHOTO_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null

  # Required for browser-to-S3 presigned PUT uploads from authoring UIs.
  aws --profile "$PROFILE" --region "$REGION" s3api put-bucket-cors \
    --bucket "$PHOTO_BUCKET" \
    --cors-configuration '{
      "CORSRules": [
        {
          "AllowedOrigins": [
            "https://d39s45clv1oor3.cloudfront.net",
            "https://www.grayson-wills.com",
            "http://localhost:4200",
            "http://localhost:4300"
          ],
          "AllowedMethods": ["GET", "HEAD", "PUT"],
          "AllowedHeaders": ["*"],
          "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
          "MaxAgeSeconds": 3000
        }
      ]
    }' >/dev/null

  aws --profile "$PROFILE" --region "$REGION" s3api put-bucket-lifecycle-configuration \
    --bucket "$PHOTO_BUCKET" \
    --lifecycle-configuration '{
      "Rules": [
        {
          "ID": "AbortIncompleteMultipartUploads",
          "Status": "Enabled",
          "Filter": { "Prefix": "'"${PHOTO_PREFIX}"'" },
          "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
        }
      ]
    }' >/dev/null
}

ensure_dynamodb_table() {
  if aws --profile "$PROFILE" --region "$REGION" dynamodb describe-table --table-name "$PHOTO_TABLE_NAME" >/dev/null 2>&1; then
    log "DynamoDB table exists: $PHOTO_TABLE_NAME"
  else
    log "Creating DynamoDB table: $PHOTO_TABLE_NAME"
    local gsi_json
    gsi_json="$(mktemp)"
    cat > "$gsi_json" <<EOF
[
  {
    "IndexName": "GSI1",
    "KeySchema": [
      { "AttributeName": "gsi1pk", "KeyType": "HASH" },
      { "AttributeName": "gsi1sk", "KeyType": "RANGE" }
    ],
    "Projection": { "ProjectionType": "ALL" }
  },
  {
    "IndexName": "GSI2",
    "KeySchema": [
      { "AttributeName": "gsi2pk", "KeyType": "HASH" },
      { "AttributeName": "gsi2sk", "KeyType": "RANGE" }
    ],
    "Projection": { "ProjectionType": "ALL" }
  }
]
EOF

    aws --profile "$PROFILE" --region "$REGION" dynamodb create-table \
      --table-name "$PHOTO_TABLE_NAME" \
      --billing-mode PAY_PER_REQUEST \
      --attribute-definitions \
        AttributeName=asset_id,AttributeType=S \
        AttributeName=gsi1pk,AttributeType=S \
        AttributeName=gsi1sk,AttributeType=S \
        AttributeName=gsi2pk,AttributeType=S \
        AttributeName=gsi2sk,AttributeType=S \
      --key-schema AttributeName=asset_id,KeyType=HASH \
      --global-secondary-indexes "file://${gsi_json}" >/dev/null

    aws --profile "$PROFILE" --region "$REGION" dynamodb wait table-exists --table-name "$PHOTO_TABLE_NAME"
  fi

  aws --profile "$PROFILE" --region "$REGION" dynamodb update-continuous-backups \
    --table-name "$PHOTO_TABLE_NAME" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null

  # Optional hardening where supported.
  aws --profile "$PROFILE" --region "$REGION" dynamodb update-table \
    --table-name "$PHOTO_TABLE_NAME" \
    --deletion-protection-enabled >/dev/null || true
}

upsert_inline_policy_statement() {
  local role_name="$1"
  local policy_name="$2"
  local sid="$3"
  local statement_json="$4"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  aws --profile "$PROFILE" iam get-role-policy \
    --role-name "$role_name" \
    --policy-name "$policy_name" \
    --query 'PolicyDocument' --output json > "$tmp_dir/policy.json"

  jq --arg sid "$sid" --argjson st "$statement_json" '
    .Statement |= ((map(select(.Sid != $sid))) + [$st])
  ' "$tmp_dir/policy.json" > "$tmp_dir/policy-updated.json"

  aws --profile "$PROFILE" iam put-role-policy \
    --role-name "$role_name" \
    --policy-name "$policy_name" \
    --policy-document "file://$tmp_dir/policy-updated.json" >/dev/null
}

ensure_iam_permissions() {
  local bucket_arn="arn:aws:s3:::${PHOTO_BUCKET}"
  local object_arn="arn:aws:s3:::${PHOTO_BUCKET}/${PHOTO_PREFIX}*"
  local table_arn="arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${PHOTO_TABLE_NAME}"
  local index_arn="${table_arn}/index/*"

  local s3_statement ddb_statement
  s3_statement="$(jq -nc --arg bucket "$bucket_arn" --arg object "$object_arn" '{
    Sid:"PhotoAssetsS3Access",
    Effect:"Allow",
    Action:[
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts"
    ],
    Resource:[$bucket,$object]
  }')"

  ddb_statement="$(jq -nc --arg table "$table_arn" --arg index "$index_arn" '{
    Sid:"PhotoAssetsDdbAccess",
    Effect:"Allow",
    Action:[
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query"
    ],
    Resource:[$table,$index]
  }')"

  upsert_inline_policy_statement "$TASK_ROLE_NAME" "$TASK_ROLE_POLICY_NAME" "PhotoAssetsS3Access" "$s3_statement"
  upsert_inline_policy_statement "$TASK_ROLE_NAME" "$TASK_ROLE_POLICY_NAME" "PhotoAssetsDdbAccess" "$ddb_statement"
}

main() {
  log "Region: $REGION | Account: $ACCOUNT_ID"
  create_bucket_if_missing
  secure_bucket
  ensure_dynamodb_table
  ensure_iam_permissions

  cat <<EOF

Photo assets stack configured successfully.
  Region: ${REGION}
  Bucket: ${PHOTO_BUCKET}
  Prefix: ${PHOTO_PREFIX}
  DynamoDB table: ${PHOTO_TABLE_NAME}
  Task role policy updated: ${TASK_ROLE_NAME}/${TASK_ROLE_POLICY_NAME}

Next:
  1) Ensure ECS task definition includes:
     - PHOTO_ASSETS_BUCKET=${PHOTO_BUCKET}
     - PHOTO_ASSETS_PREFIX=${PHOTO_PREFIX}
     - PHOTO_ASSETS_TABLE_NAME=${PHOTO_TABLE_NAME}
  2) Deploy redis-api ECS service so new env + routes are active.
  3) In blog authoring, uploads now use:
     - POST /api/photo-assets/upload-url
     - POST /api/photo-assets/{assetId}/complete

EOF
}

main "$@"
