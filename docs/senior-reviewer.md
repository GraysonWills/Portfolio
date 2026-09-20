# Automated senior reviewer

The reviewer uses OpenAI Responses with native Node `fetch`. GPT-6 Astra is the code default, with low reasoning and a configurable reasoning/output allowance. The previous `gpt-4o-mini` profile remains available for an explicit rollback. The existing Markdown report, diff limits, PR-comment marker, and advisory review policy remain in place.

## Configuration

| Setting | Default or behavior |
| --- | --- |
| `OPENAI_API_KEY` | GitHub repository secret; never written to artifacts. Missing keys produce a labeled skipped result. |
| `OPENAI_REVIEW_MODEL` | `gpt-6-astra`. CI precedence: manual model input, repository variable, legacy secret, code/workflow default. |
| `OPENAI_REVIEW_REASONING_EFFORT` | `low` for Astra. Configure through the matching repository variable. The legacy profile omits reasoning. |
| `OPENAI_REVIEW_MAX_TOKENS` | 25,000 for Astra; 1,400 for `gpt-4o-mini`. This includes reasoning headroom, not just visible Markdown. Measure usage before reducing it. |
| `OPENAI_REVIEW_TIMEOUT_MS` | 120,000 total per review, including body reading, retry delays, and retries. |
| `OPENAI_REVIEW_MAX_RETRIES` | One retry for transient HTTP failures. Evaluations use zero retries to bound costs and expose failures. |
| `REVIEW_REQUIRE_SUCCESS` | `true` for manual canaries, so a skipped, failed, or incomplete review fails the run after writing artifacts. Routine reviews remain advisory. |
| `REVIEW_ARTIFACTS_DIR` | `artifacts` for normal reviews. |

The Astra request omits sampling parameters such as `temperature`. It does not fall back to a different model or to Chat Completions after a failure. Invalid configuration and incomplete/refused/empty responses are visible failures rather than successful reviews.

## Validation

Run offline contract checks on Node 22:

```sh
node --test scripts/senior_review.test.mjs scripts/evaluate_senior_review.test.mjs
actionlint .github/workflows/senior-review.yml
```

The manual workflow supports artifact-only live checks using the existing CI secret:

```sh
gh workflow run senior-review.yml --ref YOUR_BRANCH -f mode=evaluate
gh workflow run senior-review.yml --ref YOUR_BRANCH -f mode=review -f model=gpt-6-astra
```

For a historical canary, supply `base_sha` and `head_sha` as commit hashes. A manual run never posts a PR comment. Ordinary pull-request runs retain the existing updateable comment.

The evaluation runs 12 frozen synthetic diffs through Astra and the previous default, sequentially, with no retries. It stops on the first incomplete/provider failure instead of repeatedly paying for an incompatible request. The fixture explicitly records expected findings. The runner checks transport and Markdown structure and leaves `qualityReviewed: false`; a reviewer must assess the responses against the expected findings. Passing this small corpus does not prove general quality.

## Evidence and failure handling

Normal review artifacts contain `senior-review-report.md`, `senior-review-pr-comment.md`, and `senior-review-result.json`. The JSON records sanitized telemetry including response status, selected/returned model, usage, timing, attempts, and response/request identifiers. It is the authoritative outcome for automation; a green advisory workflow alone is not proof the model completed a review. The workflow summary also reports the outcome.

Evaluation artifacts contain `evaluation.json` and `summary.md`, with full model responses and expected findings. Token-based cost estimates use Standard short-context rates recorded September 20, 2026, and are labeled as estimates; reconcile raw usage against actual billing for caching or other rate adjustments.

## Rollback

Select the previous default through a repository variable:

```sh
gh variable set OPENAI_REVIEW_MODEL --body gpt-4o-mini
```

If an output-token override was configured, restore its recorded baseline value (1,400 for the original default) or delete the override to use the profile default. Keep any pre-existing model configuration recorded so rollback restores the actual baseline. A manual input overrides the variable for that run only.

After Astra is accepted, selecting `gpt-6-astra` through the same variable makes the choice explicit. No AWS deployment, content-data migration, MCP permission expansion, or external Mesh model change is required for this reviewer migration.

## Official references

- [Astra migration and request compatibility](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart)
- [Reasoning budget and incomplete responses](https://developers.openai.com/api/docs/guides/reasoning#allocating-space-for-reasoning)
- [API pricing](https://developers.openai.com/api/docs/pricing)
