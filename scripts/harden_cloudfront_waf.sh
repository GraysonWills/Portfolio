#!/usr/bin/env bash
set -euo pipefail

# Harden CloudFront-associated WAF Web ACLs with a consistent baseline:
# - AWSManagedRulesAmazonIpReputationList
# - AWSManagedRulesCommonRuleSet
# - AWSManagedRulesKnownBadInputsRuleSet
# - AWSManagedRulesSQLiRuleSet
# - RateLimitPerIp
#
# Usage:
#   AWS_PROFILE=grayson-sso bash scripts/harden_cloudfront_waf.sh

REGION="${AWS_REGION:-us-east-1}"
RATE_LIMIT="${RATE_LIMIT:-5000}"

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }

echo "Discovering CloudFront distributions with WAF associations..."
WEB_ACL_ARNS=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && WEB_ACL_ARNS+=("${line}")
done < <(
  aws cloudfront list-distributions \
    --query 'DistributionList.Items[?WebACLId!=`null`].WebACLId' \
    --output text \
    | tr '\t' '\n' \
    | sort -u
)

if [[ "${#WEB_ACL_ARNS[@]}" -eq 0 ]]; then
  echo "No CloudFront distributions with Web ACLs found."
  exit 0
fi

for WEB_ACL_ARN in "${WEB_ACL_ARNS[@]}"; do
  WEB_ACL_NAME="$(awk -F'/' '{print $(NF-1)}' <<< "${WEB_ACL_ARN}")"
  WEB_ACL_ID="$(awk -F'/' '{print $NF}' <<< "${WEB_ACL_ARN}")"

  echo
  echo "Loading CLOUDFRONT Web ACL ${WEB_ACL_NAME} (${WEB_ACL_ID})"

  TMP_GET="$(mktemp)"
  TMP_UPDATE="$(mktemp)"

  aws wafv2 get-web-acl \
    --region "${REGION}" \
    --scope CLOUDFRONT \
    --name "${WEB_ACL_NAME}" \
    --id "${WEB_ACL_ID}" \
    --output json > "${TMP_GET}"

  LOCK_TOKEN="$(jq -r '.LockToken' "${TMP_GET}")"
  if [[ -z "${LOCK_TOKEN}" || "${LOCK_TOKEN}" == "null" ]]; then
    echo "Missing WAF LockToken for ${WEB_ACL_NAME}" >&2
    rm -f "${TMP_GET}" "${TMP_UPDATE}"
    exit 1
  fi

  RULES_JSON="$(jq -c '.WebACL.Rules' "${TMP_GET}")"

  IP_REPUTATION_RULE='{
    "Name": "AWS-AWSManagedRulesAmazonIpReputationList",
    "Priority": 0,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesAmazonIpReputationList"
      }
    },
    "OverrideAction": { "None": {} },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesAmazonIpReputationList"
    }
  }'

  COMMON_RULE='{
    "Name": "AWS-AWSManagedRulesCommonRuleSet",
    "Priority": 1,
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
    "Priority": 2,
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
    "Priority": 3,
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

  RATE_RULE="$(jq -nc --argjson limit "${RATE_LIMIT}" '{
    Name: "RateLimitPerIp",
    Priority: 4,
    Statement: {
      RateBasedStatement: {
        Limit: $limit,
        EvaluationWindowSec: 300,
        AggregateKeyType: "IP"
      }
    },
    Action: { Block: {} },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: "RateLimitPerIp"
    }
  }')"

  UPDATED_RULES="$(
    jq -c \
      --argjson iprep "${IP_REPUTATION_RULE}" \
      --argjson common "${COMMON_RULE}" \
      --argjson known "${KNOWN_BAD_RULE}" \
      --argjson sqli "${SQLI_RULE}" \
      --argjson rate "${RATE_RULE}" '
        . as $rules
        | (if any($rules[]; .Name == $iprep.Name) then $rules else ($rules + [$iprep]) end) as $r1
        | (if any($r1[]; .Name == $common.Name) then $r1 else ($r1 + [$common]) end) as $r2
        | (if any($r2[]; .Name == $known.Name) then $r2 else ($r2 + [$known]) end) as $r3
        | (if any($r3[]; .Name == $sqli.Name) then $r3 else ($r3 + [$sqli]) end) as $r4
        | (if any($r4[]; .Name == $rate.Name) then $r4 else ($r4 + [$rate]) end)
        | sort_by(.Priority)
        | to_entries
        | map(.value + { Priority: .key })
      ' <<< "${RULES_JSON}"
  )"

  CURRENT_RULE_COUNT="$(jq '.WebACL.Rules | length' "${TMP_GET}")"
  NEW_RULE_COUNT="$(jq 'length' <<< "${UPDATED_RULES}")"
  echo "Rule count: ${CURRENT_RULE_COUNT} -> ${NEW_RULE_COUNT}"

  if [[ "${CURRENT_RULE_COUNT}" == "${NEW_RULE_COUNT}" ]]; then
    echo "No new rules needed for ${WEB_ACL_NAME}."
    rm -f "${TMP_GET}" "${TMP_UPDATE}"
    continue
  fi

  DEFAULT_ACTION="$(jq -c '.WebACL.DefaultAction' "${TMP_GET}")"
  VISIBILITY_CONFIG="$(jq -c '.WebACL.VisibilityConfig' "${TMP_GET}")"

  aws wafv2 update-web-acl \
    --region "${REGION}" \
    --scope CLOUDFRONT \
    --name "${WEB_ACL_NAME}" \
    --id "${WEB_ACL_ID}" \
    --lock-token "${LOCK_TOKEN}" \
    --default-action "${DEFAULT_ACTION}" \
    --visibility-config "${VISIBILITY_CONFIG}" \
    --rules "${UPDATED_RULES}" > "${TMP_UPDATE}"

  NEXT_LOCK_TOKEN="$(jq -r '.NextLockToken' "${TMP_UPDATE}")"
  echo "Updated ${WEB_ACL_NAME}. NextLockToken=${NEXT_LOCK_TOKEN}"

  rm -f "${TMP_GET}" "${TMP_UPDATE}"
done

echo
echo "CloudFront WAF baseline hardening complete."
