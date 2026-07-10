#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:-E28CZKZOGGZGVK}"
ROLLBACK_SNAPSHOT=""

usage() {
  cat <<'USAGE'
Usage: configure_cloudfront_public_api_cache.sh [options]

Safely configures narrow CloudFront cache behaviors for anonymous portfolio API reads.
The default mode is read-only and prints the proposed behavior changes.

Options:
  --dry-run                 Inspect and render the proposed configuration (default).
  --check                   Exit non-zero when policies or behaviors drift.
  --apply                   Create/update policies and update the distribution.
  --rollback SNAPSHOT       Restore DistributionConfig from a prior secure snapshot.
  --distribution-id ID      CloudFront distribution (default: E28CZKZOGGZGVK).
  -h, --help                Show this help.

The apply path preserves all unrelated distribution settings, writes sensitive
snapshots under a mode-700 temporary directory, and never prints origin custom headers.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --check)
      MODE="check"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --rollback)
      MODE="rollback"
      ROLLBACK_SNAPSHOT="${2:-}"
      [[ -n "$ROLLBACK_SNAPSHOT" ]] || { echo "--rollback requires a snapshot path" >&2; exit 2; }
      shift 2
      ;;
    --distribution-id)
      DIST_ID="${2:-}"
      [[ -n "$DIST_ID" ]] || { echo "--distribution-id requires a value" >&2; exit 2; }
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command_name in aws jq mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

umask 077
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-cloudfront-cache.XXXXXX")"
chmod 700 "$WORK_DIR"
POLICY_LIST_FILE="$WORK_DIR/cache-policies.json"
SNAPSHOT_FILE="$WORK_DIR/${DIST_ID}-before-public-api-cache.json"
DESIRED_DISTRIBUTION_FILE="$WORK_DIR/${DIST_ID}-desired.json"
NARROW_BEHAVIORS_FILE="$WORK_DIR/narrow-behaviors.json"

rollback_distribution() {
  local snapshot="$1"
  [[ -f "$snapshot" ]] || { echo "Snapshot does not exist: $snapshot" >&2; exit 1; }
  jq -e '.DistributionConfig and .ETag' "$snapshot" >/dev/null || {
    echo "Snapshot is not a CloudFront distribution-config response: $snapshot" >&2
    exit 1
  }

  local rollback_config="$WORK_DIR/rollback-distribution.json"
  local current_etag
  jq '.DistributionConfig' "$snapshot" > "$rollback_config"
  current_etag="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)"

  echo "Restoring distribution ${DIST_ID} from secure snapshot ${snapshot}."
  aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --if-match "$current_etag" \
    --distribution-config "file://${rollback_config}" \
    > "$WORK_DIR/rollback-result.json"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
  echo "Rollback deployed. Custom cache policies were intentionally retained for audit/reuse."
}

if [[ "$MODE" == "rollback" ]]; then
  rollback_distribution "$ROLLBACK_SNAPSHOT"
  exit 0
fi

aws cloudfront get-distribution-config --id "$DIST_ID" > "$SNAPSHOT_FILE"
chmod 600 "$SNAPSHOT_FILE"
aws cloudfront list-cache-policies --type custom > "$POLICY_LIST_FILE"

echo "Secure rollback snapshot: ${SNAPSHOT_FILE}"

write_policy_config() {
  local name="$1"
  local query_behavior="$2"
  local query_items_json="$3"
  local destination="$4"

  jq -n \
    --arg name "$name" \
    --arg query_behavior "$query_behavior" \
    --argjson query_items "$query_items_json" \
    '{
      Name: $name,
      Comment: "Portfolio anonymous public API cache; origin headers control freshness; five-minute cap",
      DefaultTTL: 0,
      MaxTTL: 300,
      MinTTL: 0,
      ParametersInCacheKeyAndForwardedToOrigin: {
        EnableAcceptEncodingGzip: true,
        EnableAcceptEncodingBrotli: true,
        HeadersConfig: { HeaderBehavior: "none" },
        CookiesConfig: { CookieBehavior: "none" },
        QueryStringsConfig: (
          if $query_behavior == "none" then
            { QueryStringBehavior: "none" }
          else
            {
              QueryStringBehavior: "whitelist",
              QueryStrings: {
                Quantity: ($query_items | length),
                Items: $query_items
              }
            }
          end
        )
      }
    }' > "$destination"
}

lookup_policy_id() {
  local name="$1"
  jq -r --arg name "$name" '
    [
      .CachePolicyList.Items[]?
      | select(.CachePolicy.CachePolicyConfig.Name == $name)
      | .CachePolicy.Id
    ][0] // empty
  ' "$POLICY_LIST_FILE"
}

ensure_policy() {
  local name="$1"
  local query_behavior="$2"
  local query_items_json="$3"
  local desired_file="$WORK_DIR/${name}.json"
  local existing_file="$WORK_DIR/${name}-existing.json"
  local policy_id

  write_policy_config "$name" "$query_behavior" "$query_items_json" "$desired_file"
  policy_id="$(lookup_policy_id "$name")"

  if [[ -z "$policy_id" ]]; then
    if [[ "$MODE" == "apply" ]]; then
      policy_id="$(aws cloudfront create-cache-policy \
        --cache-policy-config "file://${desired_file}" \
        --query 'CachePolicy.Id' \
        --output text)"
      echo "Created cache policy ${name} (${policy_id})." >&2
    elif [[ "$MODE" == "check" ]]; then
      echo "Missing cache policy: ${name}" >&2
      return 1
    else
      echo "Would create cache policy: ${name}" >&2
      echo "PENDING:${name}"
      return 0
    fi
  else
    aws cloudfront get-cache-policy-config --id "$policy_id" > "$existing_file"
    if ! diff -q \
      <(jq -S '.CachePolicyConfig' "$existing_file") \
      <(jq -S '.' "$desired_file") \
      >/dev/null; then
      if [[ "$MODE" == "apply" ]]; then
        local policy_etag
        policy_etag="$(jq -r '.ETag' "$existing_file")"
        aws cloudfront update-cache-policy \
          --id "$policy_id" \
          --if-match "$policy_etag" \
          --cache-policy-config "file://${desired_file}" \
          > "$WORK_DIR/${name}-update-result.json"
        echo "Updated cache policy ${name} (${policy_id})." >&2
      elif [[ "$MODE" == "check" ]]; then
        echo "Cache policy drift: ${name} (${policy_id})" >&2
        return 1
      else
        echo "Would update cache policy: ${name} (${policy_id})" >&2
      fi
    else
      echo "Cache policy is current: ${name} (${policy_id})." >&2
    fi
  fi

  echo "$policy_id"
}

NO_QUERY_POLICY_ID="$(ensure_policy 'Portfolio-PublicApi-NoQuery-v1' 'none' '[]')"
PAGED_POLICY_ID="$(ensure_policy 'Portfolio-PublicApi-Paged-v1' 'whitelist' '["limit","nextToken"]')"
BLOG_CARDS_POLICY_ID="$(ensure_policy 'Portfolio-PublicBlogCards-v1' 'whitelist' '["limit","nextToken","q","category"]')"
BLOG_MEDIA_POLICY_ID="$(ensure_policy 'Portfolio-PublicBlogMedia-v1' 'whitelist' '["listItemIDs"]')"

API_BEHAVIOR_FILE="$WORK_DIR/api-template.json"
API_BEHAVIOR_COUNT="$(jq '[.DistributionConfig.CacheBehaviors.Items[]? | select(.PathPattern == "api/*")] | length' "$SNAPSHOT_FILE")"
[[ "$API_BEHAVIOR_COUNT" == "1" ]] || {
  echo "Expected exactly one api/* behavior; found ${API_BEHAVIOR_COUNT}." >&2
  exit 1
}
jq '.DistributionConfig.CacheBehaviors.Items[] | select(.PathPattern == "api/*")' \
  "$SNAPSHOT_FILE" > "$API_BEHAVIOR_FILE"

make_behavior() {
  local path_pattern="$1"
  local policy_id="$2"
  local destination="$3"

  jq \
    --arg path_pattern "$path_pattern" \
    --arg policy_id "$policy_id" \
    '.PathPattern = $path_pattern
     | .CachePolicyId = $policy_id
     | .ViewerProtocolPolicy = "redirect-to-https"
     | .Compress = true
     | .AllowedMethods = {
         Quantity: 2,
         Items: ["HEAD", "GET"],
         CachedMethods: { Quantity: 2, Items: ["HEAD", "GET"] }
       }
     | del(.OriginRequestPolicyId, .ForwardedValues)' \
    "$API_BEHAVIOR_FILE" > "$destination"
}

make_behavior 'api/content/v2/blog/cards/media' "$BLOG_MEDIA_POLICY_ID" "$WORK_DIR/behavior-01-media.json"
make_behavior 'api/content/v2/blog/cards' "$BLOG_CARDS_POLICY_ID" "$WORK_DIR/behavior-02-cards.json"
make_behavior 'api/content/v3/projects/categories' "$PAGED_POLICY_ID" "$WORK_DIR/behavior-03-categories.json"
make_behavior 'api/content/v3/bootstrap' "$NO_QUERY_POLICY_ID" "$WORK_DIR/behavior-04-bootstrap.json"
make_behavior 'api/content/v3/landing' "$NO_QUERY_POLICY_ID" "$WORK_DIR/behavior-05-landing.json"
make_behavior 'api/content/v3/work' "$PAGED_POLICY_ID" "$WORK_DIR/behavior-06-work.json"
make_behavior 'api/content/v3/blog/*' "$NO_QUERY_POLICY_ID" "$WORK_DIR/behavior-07-blog-detail.json"

jq -s '.' \
  "$WORK_DIR/behavior-01-media.json" \
  "$WORK_DIR/behavior-02-cards.json" \
  "$WORK_DIR/behavior-03-categories.json" \
  "$WORK_DIR/behavior-04-bootstrap.json" \
  "$WORK_DIR/behavior-05-landing.json" \
  "$WORK_DIR/behavior-06-work.json" \
  "$WORK_DIR/behavior-07-blog-detail.json" \
  > "$NARROW_BEHAVIORS_FILE"

NARROW_PATHS_JSON='[
  "api/content/v2/blog/cards/media",
  "api/content/v2/blog/cards",
  "api/content/v3/projects/categories",
  "api/content/v3/bootstrap",
  "api/content/v3/landing",
  "api/content/v3/work",
  "api/content/v3/blog/*"
]'

jq \
  --slurpfile narrow "$NARROW_BEHAVIORS_FILE" \
  --argjson narrow_paths "$NARROW_PATHS_JSON" \
  '.DistributionConfig
   | .CacheBehaviors.Items = (
       $narrow[0]
       + [
           .CacheBehaviors.Items[]?
           as $behavior
           | select(($narrow_paths | index($behavior.PathPattern)) == null)
         ]
     )
   | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)' \
  "$SNAPSHOT_FILE" > "$DESIRED_DISTRIBUTION_FILE"

CURRENT_CONFIG_FILE="$WORK_DIR/current-distribution.json"
jq '.DistributionConfig' "$SNAPSHOT_FILE" > "$CURRENT_CONFIG_FILE"

if diff -q \
  <(jq -S '.' "$CURRENT_CONFIG_FILE") \
  <(jq -S '.' "$DESIRED_DISTRIBUTION_FILE") \
  >/dev/null; then
  echo "Distribution cache behaviors are current."
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  echo "Distribution cache behavior drift detected for ${DIST_ID}." >&2
  exit 1
fi

if [[ "$MODE" == "dry-run" ]]; then
  echo "Dry run: distribution ${DIST_ID} would receive these narrow behaviors:"
  jq -r '.CacheBehaviors.Items[:7][] | "  \(.PathPattern) -> \(.CachePolicyId)"' \
    "$DESIRED_DISTRIBUTION_FILE"
  echo "No AWS resources were changed. Re-run with --apply after backend cache-safety checks pass."
  exit 0
fi

ETAG="$(jq -r '.ETag' "$SNAPSHOT_FILE")"
aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://${DESIRED_DISTRIBUTION_FILE}" \
  > "$WORK_DIR/update-result.json"

echo "CloudFront update accepted. Waiting for distribution ${DIST_ID} to deploy..."
aws cloudfront wait distribution-deployed --id "$DIST_ID"

VERIFY_FILE="$WORK_DIR/${DIST_ID}-after-public-api-cache.json"
aws cloudfront get-distribution-config --id "$DIST_ID" > "$VERIFY_FILE"
for expected_path in \
  'api/content/v2/blog/cards/media' \
  'api/content/v2/blog/cards' \
  'api/content/v3/projects/categories' \
  'api/content/v3/bootstrap' \
  'api/content/v3/landing' \
  'api/content/v3/work' \
  'api/content/v3/blog/*'; do
  jq -e --arg path "$expected_path" '
    any(.DistributionConfig.CacheBehaviors.Items[]?; .PathPattern == $path)
  ' "$VERIFY_FILE" >/dev/null || {
    echo "Verification failed: missing behavior ${expected_path}." >&2
    exit 1
  }
done

echo "Distribution deployed with all seven narrow public API behaviors."
echo "Rollback command: $0 --distribution-id ${DIST_ID} --rollback ${SNAPSHOT_FILE}"
echo "Next: verify Miss -> Hit/Age, query-key separation, no-store errors, and uncached sensitive routes."
