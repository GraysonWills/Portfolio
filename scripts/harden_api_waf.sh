#!/usr/bin/env bash
set -euo pipefail

# Harden existing REGIONAL WAF Web ACL for portfolio API by ensuring
# baseline managed rule groups are present.
#
# Defaults target the current production API WAF in us-east-2.
#
# Usage:
#   AWS_PROFILE=grayson-sso bash scripts/harden_api_waf.sh

REGION="${AWS_REGION:-us-east-2}"
WEB_ACL_NAME="${WEB_ACL_NAME:-portfolio-api-waf}"
WEB_ACL_ID="${WEB_ACL_ID:-e2d499f3-a514-4fd3-bb1d-5734951656ee}"
SCOPE="REGIONAL"

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }

echo "Loading Web ACL ${WEB_ACL_NAME} (${WEB_ACL_ID}) in ${REGION}"
aws wafv2 get-web-acl \
  --region "${REGION}" \
  --scope "${SCOPE}" \
  --name "${WEB_ACL_NAME}" \
  --id "${WEB_ACL_ID}" \
  --output json >/tmp/api-waf-get.json

LOCK_TOKEN="$(jq -r '.LockToken' /tmp/api-waf-get.json)"
if [[ -z "${LOCK_TOKEN}" || "${LOCK_TOKEN}" == "null" ]]; then
  echo "Missing WAF LockToken" >&2
  exit 1
fi

RULES_JSON="$(jq -c '.WebACL.Rules' /tmp/api-waf-get.json)"

COMMON_RULE='{
  "Name": "AWS-AWSManagedRulesCommonRuleSet",
  "Priority": 2,
  "Statement": {
    "ManagedRuleGroupStatement": {
      "VendorName": "AWS",
      "Name": "AWSManagedRulesCommonRuleSet"
    }
  },
  "OverrideAction": { "None": {} },
  "VisibilityConfig": {
    "SampledRequestsEnabled": true,
    "CloudWatchMetricsEnabled": true,
    "MetricName": "AWSManagedRulesCommonRuleSet"
  }
}'

KNOWN_BAD_RULE='{
  "Name": "AWS-AWSManagedRulesKnownBadInputsRuleSet",
  "Priority": 3,
  "Statement": {
    "ManagedRuleGroupStatement": {
      "VendorName": "AWS",
      "Name": "AWSManagedRulesKnownBadInputsRuleSet"
    }
  },
  "OverrideAction": { "None": {} },
  "VisibilityConfig": {
    "SampledRequestsEnabled": true,
    "CloudWatchMetricsEnabled": true,
    "MetricName": "AWSManagedRulesKnownBadInputsRuleSet"
  }
}'

SQLI_RULE='{
  "Name": "AWS-AWSManagedRulesSQLiRuleSet",
  "Priority": 4,
  "Statement": {
    "ManagedRuleGroupStatement": {
      "VendorName": "AWS",
      "Name": "AWSManagedRulesSQLiRuleSet"
    }
  },
  "OverrideAction": { "None": {} },
  "VisibilityConfig": {
    "SampledRequestsEnabled": true,
    "CloudWatchMetricsEnabled": true,
    "MetricName": "AWSManagedRulesSQLiRuleSet"
  }
}'

UPDATED_RULES="$(
  jq -c \
    --argjson common "${COMMON_RULE}" \
    --argjson known "${KNOWN_BAD_RULE}" \
    --argjson sqli "${SQLI_RULE}" '
      . as $rules
      | (if any($rules[]; .Name == $common.Name) then $rules else ($rules + [$common]) end) as $r1
      | (if any($r1[]; .Name == $known.Name) then $r1 else ($r1 + [$known]) end) as $r2
      | (if any($r2[]; .Name == $sqli.Name) then $r2 else ($r2 + [$sqli]) end)
      | sort_by(.Priority)
      | to_entries
      | map(.value + { Priority: .key })
    ' <<< "${RULES_JSON}"
)"

CURRENT_RULE_COUNT="$(jq '.WebACL.Rules | length' /tmp/api-waf-get.json)"
NEW_RULE_COUNT="$(jq 'length' <<< "${UPDATED_RULES}")"
echo "Rule count: ${CURRENT_RULE_COUNT} -> ${NEW_RULE_COUNT}"

if [[ "${CURRENT_RULE_COUNT}" == "${NEW_RULE_COUNT}" ]]; then
  echo "No new WAF managed rules needed. Already hardened."
  exit 0
fi

DEFAULT_ACTION="$(jq -c '.WebACL.DefaultAction' /tmp/api-waf-get.json)"
VISIBILITY_CONFIG="$(jq -c '.WebACL.VisibilityConfig' /tmp/api-waf-get.json)"

aws wafv2 update-web-acl \
  --region "${REGION}" \
  --scope "${SCOPE}" \
  --name "${WEB_ACL_NAME}" \
  --id "${WEB_ACL_ID}" \
  --lock-token "${LOCK_TOKEN}" \
  --default-action "${DEFAULT_ACTION}" \
  --visibility-config "${VISIBILITY_CONFIG}" \
  --rules "${UPDATED_RULES}" >/tmp/api-waf-update.json

NEW_LOCK_TOKEN="$(jq -r '.NextLockToken' /tmp/api-waf-update.json)"
echo "WAF updated successfully. NextLockToken=${NEW_LOCK_TOKEN}"
