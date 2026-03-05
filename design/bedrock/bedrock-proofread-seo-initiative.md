# Bedrock Editorial Pipeline Initiative (Proofread + Markup + SEO)

Status: Research and planning only (not implemented yet)  
Region target: `us-east-1`  
Last updated: 2026-02-22

## 1) Objective

Create a low-cost, AWS-native pipeline from Blog Authoring that can:

1. Proofread post text.
2. Propose markup/style improvements.
3. Generate SEO metadata (title alternatives, meta description, slug, keywords).
4. Keep human approval in the loop before publish.

This should avoid external API keys and run with AWS IAM credentials.

## 2) Recommended Architecture (Least Cost First)

### Components

1. `blog-authoring-gui` UI actions:
   - `Proofread + SEO` button in editor.
   - `Apply Suggestions` (selective accept/reject).
2. `redis-api-server` endpoint (authenticated):
   - `POST /api/editorial/optimize`
3. AWS compute:
   - Existing backend runtime (or Lambda worker) calls Amazon Bedrock `Converse`.
4. Data storage:
   - Store suggestions alongside draft metadata (do not overwrite original body automatically).
5. Optional publish hook:
   - On publish/schedule, trigger newsletter job (SES) separately from editorial optimization.

### Flow

1. Editor submits current draft body + title + tags to `/api/editorial/optimize`.
2. Backend sends one `Converse` request to Bedrock with strict JSON schema response instructions:
   - `corrected_content`
   - `changes[]` (diff-like)
   - `seo` (`title`, `meta_description`, `slug`, `keywords[]`, `social_excerpt`)
3. Backend validates JSON schema and stores suggestion artifact.
4. UI renders side-by-side diff and per-change apply controls.
5. User accepts/rejects suggestions, then saves draft or schedules/publishes.

## 3) Why This Is Cheapest

1. One model call per optimization action (not three separate calls).
2. No Step Functions needed initially (Lambda/backend direct call is enough).
3. No external LLM provider/API key overhead.
4. EventBridge Scheduler already has a large free tier for scheduled invocations.
5. SES cost remains linear and low for blog notification sends.

## 4) Model Strategy and Cost Comparison

Assumption for estimate per optimization request:
- Input: `~2,500` tokens (draft + prompt instructions)
- Output: `~1,000` tokens (rewritten content + SEO object + explanations)

### Option A (recommended for lowest cost): Google Gemma 3 4B on Bedrock

- Pricing (US East): input `$0.00004/1K`, output `$0.00008/1K`
- Estimated cost/request:
  - Input: `2.5 * 0.00004 = $0.00010`
  - Output: `1.0 * 0.00008 = $0.00008`
  - Total: `$0.00018` per request
- At 1,000 optimizations/month: `$0.18/month`

### Option B (still low, higher quality headroom): Google Gemma 3 12B

- Pricing (US East): input `$0.00009/1K`, output `$0.00029/1K`
- Estimated cost/request:
  - Input: `2.5 * 0.00009 = $0.000225`
  - Output: `1.0 * 0.00029 = $0.00029`
  - Total: `$0.000515` per request
- At 1,000 optimizations/month: `$0.515/month`

### Option C (premium quality fallback only): Anthropic Claude 3.5 Sonnet

- Pricing: input `$6.00/1M`, output `$30.00/1M`
- Estimated cost/request:
  - Input: `2,500/1,000,000 * 6.00 = $0.015`
  - Output: `1,000/1,000,000 * 30.00 = $0.03`
  - Total: `$0.045` per request
- At 1,000 optimizations/month: `$45/month`

### Recommendation

Run Option A as default. Add an optional "High Quality Pass" toggle that uses Option C only for final pre-publish checks when needed.

## 5) Security and Governance

1. Use IAM role-based auth for Bedrock invocation (no third-party secrets required).
2. Restrict policy to only required model IDs and `bedrock:InvokeModel`.
3. Keep blog authoring endpoint behind existing auth.
4. Add API throttling + WAF rate-based limits to protect cost and availability.
5. Enable Bedrock invocation logging to CloudWatch/S3 for auditability.
6. Log prompt/response hashes and request IDs, not raw PII-heavy payloads unless needed.

## 6) Suggested API Contract

### Request

`POST /api/editorial/optimize`

```json
{
  "postId": "blog-123",
  "title": "Draft title",
  "summary": "Optional short summary",
  "contentMarkdown": "## Body...",
  "tags": ["ai", "computer-vision"],
  "targetKeyword": "industrial quality inspection",
  "tone": "professional",
  "maxOutputTokens": 1400
}
```

### Response

```json
{
  "model": "google.gemma-3-4b-it-v1:0",
  "optimized": {
    "correctedContentMarkdown": "...",
    "changes": [
      {
        "type": "grammar",
        "before": "...",
        "after": "...",
        "rationale": "..."
      }
    ],
    "seo": {
      "title": "...",
      "metaDescription": "...",
      "slug": "...",
      "keywords": ["...", "..."],
      "socialExcerpt": "..."
    },
    "scorecard": {
      "readability": 0,
      "seoCoverage": 0,
      "clarity": 0
    }
  }
}
```

## 7) Implementation Plan (If Approved)

### Phase 0: Guardrails and quotas

1. Confirm model access in Bedrock (`us-east-1`).
2. Add IAM policy scoped to chosen model IDs.
3. Add API Gateway/WAF rate limits for editorial endpoint.

### Phase 1: Backend

1. Add `/api/editorial/optimize`.
2. Implement Bedrock `Converse` call and strict response schema validator.
3. Persist suggestion artifact and model metadata.
4. Add retries with capped backoff for transient failures.

### Phase 2: Blog Authoring UI

1. Add `Proofread + SEO` action.
2. Add diff panel with apply/reject controls.
3. Add `Use SEO suggestions` quick-apply for title/summary/slug/tags.

### Phase 3: Publish integration

1. Ensure scheduled or immediate publish can include approved SEO fields.
2. Do not auto-apply any LLM change without explicit editor action.

### Phase 4: Observability and ops

1. CloudWatch metrics: latency, failures, token usage.
2. Invocation logging enabled for Bedrock.
3. Alarm on elevated failures or token spikes.

## 8) Cost Notes Beyond Bedrock

1. EventBridge Scheduler: first `14,000,000` invocations/month are free.
2. SES outbound email: `$0.10/1,000` emails (+ attachment data transfer as applicable).
3. API Gateway/WAF have separate costs; configure throttles to prevent accidental burst spend.

## 9) Decision Required

Choose one path:

1. Implement now with Option A (Gemma 3 4B default, low cost).
2. Implement now with Option B (Gemma 3 12B default, slightly higher quality).
3. Delay implementation and only keep this plan documented.

## References

1. Amazon Bedrock pricing: https://aws.amazon.com/bedrock/pricing/  
2. Bedrock Converse API reference: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html  
3. Using Converse API: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference-call.html  
4. Bedrock API key/IAM guidance: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_bedrock.html  
5. Bedrock API key best-practice guidance: https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-how.html  
6. Bedrock invocation logging: https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html  
7. API Gateway usage plans/throttling caveat: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html  
8. API Gateway request throttling: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html  
9. AWS WAF rate-based rules: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html  
10. EventBridge Scheduler quotas: https://docs.aws.amazon.com/scheduler/latest/UserGuide/scheduler-quotas.html  
11. EventBridge pricing (scheduler free tier detail): https://www.amazonaws.cn/en/eventbridge/pricing/  
12. Amazon SES pricing: https://aws.amazon.com/en/ses/pricing/  
13. SES subscription management and unsubscribe handling: https://docs.aws.amazon.com/ses/latest/dg/sending-email-subscription-management.html
