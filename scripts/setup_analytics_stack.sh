#!/usr/bin/env bash
set -euo pipefail

# Provisions a low-cost analytics data pipeline:
# public app events -> API -> SQS -> Lambda -> S3 (ndjson.gz) -> Athena views.

PROFILE="${AWS_PROFILE:-grayson-sso}"
REGION="${AWS_REGION:-us-east-2}"
ACCOUNT_ID="$(aws --profile "$PROFILE" sts get-caller-identity --query 'Account' --output text)"

ANALYTICS_QUEUE_NAME="${ANALYTICS_QUEUE_NAME:-portfolio-analytics-events}"
ANALYTICS_DLQ_NAME="${ANALYTICS_DLQ_NAME:-portfolio-analytics-events-dlq}"
ANALYTICS_BUCKET="${ANALYTICS_BUCKET:-grayson-wills-analytics-${ACCOUNT_ID}-${REGION}}"
ANALYTICS_S3_PREFIX="$(echo "${ANALYTICS_S3_PREFIX:-events/}" | sed 's#^/*##; s#/*$#/#')"
ATHENA_RESULTS_PREFIX="$(echo "${ATHENA_RESULTS_PREFIX:-athena-results/}" | sed 's#^/*##; s#/*$#/#')"
ATHENA_WORKGROUP="${ATHENA_WORKGROUP:-portfolio-analytics}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-portfolio-redis-api}"
TASK_ROLE_NAME="${TASK_ROLE_NAME:-PortfolioRedisApiTaskRole}"
TASK_ROLE_POLICY_NAME="${TASK_ROLE_POLICY_NAME:-PortfolioRedisApiS3Uploads}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-PortfolioRedisApiLambdaRole}"
LAMBDA_ROLE_POLICY_NAME="${LAMBDA_ROLE_POLICY_NAME:-PortfolioRedisApiLambdaPolicy}"

log() { echo "[analytics-setup] $*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws
require_cmd jq

create_bucket_if_missing() {
  if aws --profile "$PROFILE" --region "$REGION" s3api head-bucket --bucket "$ANALYTICS_BUCKET" >/dev/null 2>&1; then
    log "S3 bucket exists: $ANALYTICS_BUCKET"
    return
  fi

  log "Creating S3 bucket: $ANALYTICS_BUCKET"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws --profile "$PROFILE" --region "$REGION" s3api create-bucket --bucket "$ANALYTICS_BUCKET" >/dev/null
  else
    aws --profile "$PROFILE" --region "$REGION" s3api create-bucket \
      --bucket "$ANALYTICS_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
}

secure_bucket() {
  log "Applying encryption + public access block to $ANALYTICS_BUCKET"
  aws --profile "$PROFILE" --region "$REGION" s3api put-bucket-encryption \
    --bucket "$ANALYTICS_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null

  aws --profile "$PROFILE" --region "$REGION" s3api put-public-access-block \
    --bucket "$ANALYTICS_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
}

get_or_create_queue() {
  local name="$1"
  if aws --profile "$PROFILE" --region "$REGION" sqs get-queue-url --queue-name "$name" >/dev/null 2>&1; then
    aws --profile "$PROFILE" --region "$REGION" sqs get-queue-url --queue-name "$name" --query 'QueueUrl' --output text
    return
  fi
  aws --profile "$PROFILE" --region "$REGION" sqs create-queue --queue-name "$name" --query 'QueueUrl' --output text >/dev/null
  for _ in $(seq 1 20); do
    if aws --profile "$PROFILE" --region "$REGION" sqs get-queue-url --queue-name "$name" >/dev/null 2>&1; then
      aws --profile "$PROFILE" --region "$REGION" sqs get-queue-url --queue-name "$name" --query 'QueueUrl' --output text
      return
    fi
    sleep 2
  done
  echo "Failed to resolve queue URL for $name after create" >&2
  exit 1
}

wait_athena_query() {
  local qid="$1"
  while true; do
    local state
    state="$(aws --profile "$PROFILE" --region "$REGION" athena get-query-execution \
      --query-execution-id "$qid" \
      --query 'QueryExecution.Status.State' --output text)"
    if [[ "$state" == "SUCCEEDED" ]]; then
      return 0
    fi
    if [[ "$state" == "FAILED" || "$state" == "CANCELLED" ]]; then
      aws --profile "$PROFILE" --region "$REGION" athena get-query-execution \
        --query-execution-id "$qid" \
        --query 'QueryExecution.Status.StateChangeReason' --output text >&2 || true
      return 1
    fi
    sleep 2
  done
}

run_athena_sql() {
  local sql="$1"
  local out_loc="s3://${ANALYTICS_BUCKET}/${ATHENA_RESULTS_PREFIX}"
  local qid
  qid="$(aws --profile "$PROFILE" --region "$REGION" athena start-query-execution \
    --work-group "$ATHENA_WORKGROUP" \
    --query-string "$sql" \
    --result-configuration "OutputLocation=${out_loc}" \
    --query 'QueryExecutionId' --output text)"
  wait_athena_query "$qid"
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

main() {
  log "Region: $REGION | Account: $ACCOUNT_ID"

  create_bucket_if_missing
  secure_bucket

  local dlq_url queue_url dlq_arn queue_arn redrive_policy
  dlq_url="$(get_or_create_queue "$ANALYTICS_DLQ_NAME")"
  dlq_arn="$(aws --profile "$PROFILE" --region "$REGION" sqs get-queue-attributes \
    --queue-url "$dlq_url" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

  redrive_policy="$(jq -nc --arg arn "$dlq_arn" '{deadLetterTargetArn:$arn,maxReceiveCount:"5"}')"
  queue_url="$(get_or_create_queue "$ANALYTICS_QUEUE_NAME")"
  local attrs_file
  attrs_file="$(mktemp)"
  jq -n --arg rp "$redrive_policy" '{
    RedrivePolicy: $rp,
    VisibilityTimeout: "60",
    MessageRetentionPeriod: "1209600",
    ReceiveMessageWaitTimeSeconds: "20"
  }' > "$attrs_file"
  aws --profile "$PROFILE" --region "$REGION" sqs set-queue-attributes \
    --queue-url "$queue_url" \
    --attributes "file://$attrs_file" >/dev/null

  queue_arn="$(aws --profile "$PROFILE" --region "$REGION" sqs get-queue-attributes \
    --queue-url "$queue_url" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

  log "Analytics queue URL: $queue_url"
  log "Analytics queue ARN: $queue_arn"

  # Task role: allow ECS API service to enqueue analytics events.
  local task_statement
  task_statement="$(jq -nc --arg q "$queue_arn" '{
    Sid:"SqsAnalyticsQueueSend",
    Effect:"Allow",
    Action:["sqs:GetQueueAttributes","sqs:SendMessage","sqs:SendMessageBatch"],
    Resource:[$q]
  }')"
  upsert_inline_policy_statement "$TASK_ROLE_NAME" "$TASK_ROLE_POLICY_NAME" "SqsAnalyticsQueueSend" "$task_statement"

  # Lambda role: allow queue consume and S3 writes for analytics.
  local lambda_sqs_statement lambda_s3_write_statement lambda_s3_bucket_statement
  lambda_sqs_statement="$(jq -nc --arg q "$queue_arn" --arg d "$dlq_arn" '{
    Sid:"SqsAnalyticsQueueConsume",
    Effect:"Allow",
    Action:["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:ChangeMessageVisibility","sqs:GetQueueAttributes"],
    Resource:[$q,$d]
  }')"
  lambda_s3_write_statement="$(jq -nc --arg b "arn:aws:s3:::${ANALYTICS_BUCKET}/${ANALYTICS_S3_PREFIX}*" '{
    Sid:"AnalyticsS3Write",
    Effect:"Allow",
    Action:["s3:PutObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],
    Resource:$b
  }')"
  lambda_s3_bucket_statement="$(jq -nc --arg b "arn:aws:s3:::${ANALYTICS_BUCKET}" '{
    Sid:"AnalyticsS3Bucket",
    Effect:"Allow",
    Action:["s3:ListBucket","s3:GetBucketLocation"],
    Resource:$b
  }')"
  upsert_inline_policy_statement "$LAMBDA_ROLE_NAME" "$LAMBDA_ROLE_POLICY_NAME" "SqsAnalyticsQueueConsume" "$lambda_sqs_statement"
  upsert_inline_policy_statement "$LAMBDA_ROLE_NAME" "$LAMBDA_ROLE_POLICY_NAME" "AnalyticsS3Write" "$lambda_s3_write_statement"
  upsert_inline_policy_statement "$LAMBDA_ROLE_NAME" "$LAMBDA_ROLE_POLICY_NAME" "AnalyticsS3Bucket" "$lambda_s3_bucket_statement"

  # Lambda env vars.
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  aws --profile "$PROFILE" --region "$REGION" lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'Environment.Variables' --output json > "$tmp_dir/current-env.json"

  jq --arg queue_url "$queue_url" \
    --arg bucket "$ANALYTICS_BUCKET" \
    --arg prefix "$ANALYTICS_S3_PREFIX" \
    --arg region "$REGION" \
    '.ANALYTICS_QUEUE_ENABLED = "true"
     | .ANALYTICS_QUEUE_URL = $queue_url
     | .ANALYTICS_S3_BUCKET = $bucket
     | .ANALYTICS_S3_PREFIX = $prefix
     | .ANALYTICS_S3_REGION = $region
     | .ANALYTICS_DEFAULT_SOURCE = "portfolio-app"' \
    "$tmp_dir/current-env.json" > "$tmp_dir/new-vars.json"
  jq -n --slurpfile v "$tmp_dir/new-vars.json" '{Variables: $v[0]}' > "$tmp_dir/env-wrapper.json"

  aws --profile "$PROFILE" --region "$REGION" lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --environment "file://$tmp_dir/env-wrapper.json" >/dev/null
  aws --profile "$PROFILE" --region "$REGION" lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME"

  # Event source mapping from analytics queue -> Lambda.
  local existing_mapping
  existing_mapping="$(aws --profile "$PROFILE" --region "$REGION" lambda list-event-source-mappings \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --event-source-arn "$queue_arn" \
    --query 'EventSourceMappings[0].UUID' --output text)"
  if [[ "$existing_mapping" == "None" || -z "$existing_mapping" ]]; then
    aws --profile "$PROFILE" --region "$REGION" lambda create-event-source-mapping \
      --function-name "$LAMBDA_FUNCTION_NAME" \
      --event-source-arn "$queue_arn" \
      --batch-size 50 \
      --maximum-batching-window-in-seconds 30 \
      --function-response-types ReportBatchItemFailures \
      --enabled >/dev/null
    log "Created Lambda event source mapping for analytics queue."
  else
    log "Lambda event source mapping already exists: $existing_mapping"
  fi

  # Athena workgroup + schema/views
  if ! aws --profile "$PROFILE" --region "$REGION" athena get-work-group --work-group "$ATHENA_WORKGROUP" >/dev/null 2>&1; then
    aws --profile "$PROFILE" --region "$REGION" athena create-work-group \
      --name "$ATHENA_WORKGROUP" \
      --configuration "ResultConfiguration={OutputLocation=s3://${ANALYTICS_BUCKET}/${ATHENA_RESULTS_PREFIX}},EnforceWorkGroupConfiguration=true,PublishCloudWatchMetricsEnabled=true" >/dev/null
    log "Created Athena workgroup: $ATHENA_WORKGROUP"
  else
    log "Athena workgroup exists: $ATHENA_WORKGROUP"
  fi

  run_athena_sql "CREATE DATABASE IF NOT EXISTS portfolio_analytics"
  run_athena_sql "CREATE EXTERNAL TABLE IF NOT EXISTS portfolio_analytics.events_raw (version int,event_type string,event_time string,event_date string,event_hour string,route string,page string,source string,referrer string,session_id string,visitor_id string,user_agent string,ip_hash string,metadata_json string,received_at string) PARTITIONED BY (dt string,hr string) ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe' WITH SERDEPROPERTIES ('ignore.malformed.json'='true') STORED AS TEXTFILE LOCATION 's3://${ANALYTICS_BUCKET}/events/' TBLPROPERTIES ('projection.enabled'='true','projection.dt.type'='date','projection.dt.format'='yyyy-MM-dd','projection.dt.range'='2025-01-01,NOW','projection.dt.interval'='1','projection.dt.interval.unit'='DAYS','projection.hr.type'='integer','projection.hr.range'='0,23','projection.hr.digits'='2','storage.location.template'='s3://${ANALYTICS_BUCKET}/events/dt=\${dt}/hr=\${hr}/')"
  run_athena_sql "CREATE OR REPLACE VIEW portfolio_analytics.events_enriched AS SELECT CAST(from_iso8601_timestamp(event_time) AS timestamp) AS event_ts, date(CAST(from_iso8601_timestamp(event_time) AS timestamp)) AS event_day, event_type, route, page, source, referrer, session_id, visitor_id, ip_hash, metadata_json FROM portfolio_analytics.events_raw"
  run_athena_sql "CREATE OR REPLACE VIEW portfolio_analytics.events_daily AS SELECT event_day, source, event_type, route, count(*) AS event_count, approx_distinct(session_id) AS session_count, approx_distinct(visitor_id) AS visitor_count FROM portfolio_analytics.events_enriched GROUP BY 1,2,3,4"
  run_athena_sql "CREATE OR REPLACE VIEW portfolio_analytics.cta_performance_daily AS SELECT event_day, event_type, route, count(*) AS clicks FROM portfolio_analytics.events_enriched WHERE event_type LIKE '%clicked%' OR event_type LIKE '%submit%' OR event_type LIKE '%subscribe%' GROUP BY 1,2,3"

  cat <<EOF

Analytics stack configured successfully.
  Region: ${REGION}
  Queue URL: ${queue_url}
  Queue ARN: ${queue_arn}
  Bucket: ${ANALYTICS_BUCKET}
  Athena workgroup: ${ATHENA_WORKGROUP}
  Athena database: portfolio_analytics
  Athena table: portfolio_analytics.events_raw

Next:
  1) Ensure ECS task definition contains:
     - ANALYTICS_QUEUE_ENABLED=true
     - ANALYTICS_QUEUE_URL=${queue_url}
  2) Deploy API service (GitHub ECS workflow or ECS update-service).
  3) In QuickSight, create Athena data source using workgroup ${ATHENA_WORKGROUP}.
  4) Build dashboards from portfolio_analytics.events_daily and cta_performance_daily.

EOF
}

main "$@"
