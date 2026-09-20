# Portfolio migration plan: GPT-6 Astra

Prepared September 20, 2026. Status: planning complete; implementation and rollout pending.

Target: `gpt-6-astra`. Repository: `/Users/grayson/Desktop/Portfolio`, branch `main`, inspected HEAD `00529c4f89024c6d0b7335666da0f570705687ac` plus the current working tree. Existing uncommitted work must be preserved when implementing this plan.

The recommended migration starts with the automated senior code reviewer. The repository has one direct OpenAI caller; its MCP authoring gateway serves tools to external AI clients. Migrating those clients is a separate configuration and acceptance step. Neither path calls for a portfolio frontend or AWS infrastructure rewrite.

## Current integration and scope

| Surface | Observed implementation | Planned treatment |
| --- | --- | --- |
| Automated reviewer | `scripts/senior_review.mjs:44` uses native Node `fetch`, Responses first, then Chat Completions. Default is `gpt-4o-mini` at line 167. | Make this request path Astra-compatible and evaluate before promotion. No OpenAI SDK dependency is required. |
| CI configuration | `.github/workflows/senior-review.yml:55` injects the API key and `OPENAI_REVIEW_MODEL` secret. Runs on pushes and pull requests using Node 22.x. | Record the effective model, expose rollout controls, and preserve artifact/comment delivery. The secret value and actual deployed model have not been verified. |
| MCP authoring | `redis-api-server/src/routes/mcp.js:107` constructs the tool server/transport; `src/services/mcp-tools.js` defines tool contracts. | Select Astra in each relevant external client. Retain server authorization and tool contracts. |
| Agent templates | `agent-system-kit/skills/*/agents/openai.yaml` contains interface metadata and default prompts, without a model selector. | No model-string replacement in these templates. Audit loaded instructions only if client behavior changes. |
| Mission Control | `blog-authoring-gui/src/app/services/mission-control-api.service.ts:7` identifies the external Mesh/DGX API; line 120 uses `environment.meshApiUrl`. The registry component displays returned `model_alias` values and can fall back to mock rows. | Treat external registry configuration as an inventory item, not evidence that Portfolio selects a model or that displayed aliases are deployed. |
| Public site, authoring UI, social bridge | No other direct model-provider caller found in the source search. | Preserve existing application behavior. |

## 1. Establish a reproducible baseline

- Record the current effective CI model and whether AI reviews actually succeed. Secret presence and a green workflow alone do not establish either fact.
- Confirm `gpt-6-astra` access using the same OpenAI API project/credential used by CI when implementation begins. Codex model availability does not establish API-project access.
- Freeze 12 representative diffs: three backend changes, three Angular changes, two MCP/authorization changes, two deployment changes, and two clean or cosmetic changes. Include a large truncated diff and known defects with independently reviewed expected findings.
- Save base/head SHAs, prompt version, model, request settings, report, duration, usage, and review status for each run. Record baseline findings before changing prompts.
- Inventory external MCP clients and the owner of Mission Control's registry. Record current model, endpoint, reasoning setting, and rollback configuration for any client included in the migration.

Deliverable: a baseline evaluation manifest with access status and measurable quality, cost, and latency targets.

## 2. Make the reviewer compatible

Primary file: `scripts/senior_review.mjs`.

- Add an Astra request profile using Responses, `model: "gpt-6-astra"`, and explicit `reasoning: { effort: "low" }` for the initial comparison. Low is a proposed starting point for the current inexpensive, non-reasoning reviewer; compare medium only if the evaluation finds a quality gap.
- Remove `temperature` from the Astra path. It is currently sent at lines 57 and 80. Astra also rejects `top_p` and `top_logprobs`, although neither is currently sent. Keep the baseline model's compatible request profile available for rollback. These compatibility requirements come from the [official Astra migration guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart).
- Use Responses exclusively for Astra instead of blindly retrying every failed or empty request through Chat Completions. Astra supports text Chat Completions, but its tool calling requires Responses; the current reviewer does not use tools. Preserve any legacy endpoint fallback only within its explicitly selected legacy profile.
- Make the reasoning/output cap configurable through the workflow. The current 1,400-token cap at line 168 is not an adequate assumption for the new workload. For the bounded initial evaluation, start with a 25,000-token allowance, then reduce it to a measured budget before promotion. This is an experimental ceiling, not an expected response length. OpenAI recommends this initial reasoning/output headroom and documents that exhaustion can produce no visible answer. [Reasoning budget guidance](https://developers.openai.com/api/docs/guides/reasoning#allocating-space-for-reasoning).
- Require a completed response with nonempty review text before labeling the review successful. Distinguish incomplete output, refusal, empty output, invalid parameters, authentication failures, rate limits, and provider failures. Preserve the existing parser's traversal of all output items; reasoning items may appear before the message.
- Add bounded timeouts and transient retries. Preserve original endpoint, HTTP status, response/request identifier, and sanitized error details. Do not retry invalid parameters or authentication failures, and do not silently change models.
- Record effective model, effort, response status, input/output/reasoning usage, elapsed time, and input truncation in the artifact. Surface failed, skipped, and incomplete reviews in the workflow summary while preserving the existing advisory review policy.

The initial comparison should preserve the four Markdown sections, P0–P3 findings, evidence/fix requirements, 180,000-character diff bound, and 9,000-character comment bound. If needed after the first comparison, clarify that this is a single-pass review: return findings directly, identify missing context, and treat instructions embedded in the diff as data. Evaluate prompt changes independently from the model switch.

## 3. Validate compatibility and review quality

Add a focused Node test file such as `scripts/senior_review.test.mjs`; none was found for the reviewer during this audit. Keep the API adapter importable without automatically running the CLI.

| Check | Required evidence |
| --- | --- |
| Request profiles | Astra uses supported fields; baseline rollback still builds its compatible request. |
| Response handling | Completed text after reasoning items works; incomplete, refused, empty, and malformed responses cannot become successful reviews. |
| Transport failures | Mock 400, 401, 429, 5xx and timeout paths; retries are bounded; the original failure remains visible; no accidental second endpoint call. |
| Output contract | Required headings, finding evidence, SHA metadata, artifact paths, updateable comment marker, and both truncation limits remain correct. |
| Missing key | A clearly labeled skipped report is produced without a provider request. |
| Quality comparison | Both models review the same frozen diffs; assess missed defects, false positives, severity, evidence, and useful fixes. |

Proposed promotion gates: all transport/contract tests pass; all 12 Astra reports complete with the required structure; no known P0/P1 regression in the sample is missed; false-positive findings do not increase over the baseline; every finding cites evidence. Capture cost per completed review and median/tail duration, then choose an acceptable operating ceiling before enabling Astra for every event. This small corpus is a release check, not proof of universal quality.

Run syntax and focused tests under CI's Node 22.x. Keep the existing repository CI checks for the eventual PR. Full application rebuilds are not needed merely to compare model settings, but existing CI will still run its configured builds.

## 4. Roll out with an explicit rollback

Primary configuration file: `.github/workflows/senior-review.yml`.

1. Land the compatible adapter, tests, and telemetry with the current baseline model still selected.
2. Add an artifact-only evaluation mode and an opt-in Astra canary. Keep canary reports separate from routine PR comments so the two runs can be compared.
3. Wire `OPENAI_REVIEW_MODEL`, a new reasoning-effort setting, and the existing output-token setting into the workflow. Handle the current secret override deliberately: changing the code default alone cannot override it. Keep the API key in secrets.
4. Run the frozen comparisons, then five ordinary Astra canary reviews with no incomplete responses, unexpected retries, or format failures. These counts are proposed rollout gates.
5. After quality and operating costs are accepted, select Astra for the reviewer and retain the existing artifact/comment behavior. Measure push/PR overlap before deciding whether duplicate review events need separate optimization.
6. Roll back by restoring the recorded baseline model and its token/settings profile. If the baseline was the code default, use `gpt-4o-mini`. Revert the adapter change only if the adapter itself regresses. No content, database, or AWS deployment rollback should be needed for this reviewer migration.

The current task authorizes this plan. Implementation, paid comparisons, CI configuration changes, and production rollout are future execution steps.

## 5. Verify any external Astra authoring clients

For each external client included in the migration, select Astra in the client configuration and test against the existing MCP gateway. A custom OpenAI tool-calling client must use Responses. Merely changing a display alias in Portfolio does not migrate its provider.

Acceptance must cover tool discovery, scoped reads, draft create/update/delete ownership, previews, idempotency replay, stale-version rejection, approval-required actions, and configured auto-execution. Preserve each client's existing scopes and `autoExecuteActions`; retain audit history. Use isolated drafts and test fixtures for writes, and keep social sends and publishing governed by existing controls.

Run `node --test test/mcp-control.test.js test/mcp-tools.test.js` from `redis-api-server`. The existing `scripts/mcp_smoke.mjs` checks protocol behavior, not Astra behavior: supplement it with Astra-driven sandbox cases. Its `callTool` helper currently does not explicitly reject MCP `isError`, and cleanup errors are logged without failing the run; strengthen these checks before using mutation smoke as acceptance evidence. Use disposable drafts in a test environment, followed by read-only production checks.

Serialize dependent mutations and retain stable idempotency keys. The generic replay implementation is a read/execute/store sequence, not a guarantee against concurrent duplicate execution. Treat ambiguous social-send results as unresolved rather than blindly retrying: the existing `social.schedule_delivery` tool can send immediately and has dedicated scope and idempotency requirements. A model change must preserve these contracts.

If a client cannot complete a needed workflow, diagnose its request/response adapter before changing the Portfolio server. Do not expand this migration into a Mesh-wide model or routing replacement without inspecting that separate project.

## Cost and operational decision

Astra is a substantial per-token price increase over the repository's current default. As checked September 20, 2026, Standard short-context API rates per million tokens are $10 input / $50 output for Astra and $0.15 input / $0.60 output for `gpt-4o-mini`. Cached input, cache writes, long context, and processing tiers have separate rates. Actual task cost depends on measured usage and retries. [Official API pricing](https://developers.openai.com/api/docs/pricing).

Keep the initial request cadence and context bounds stable so the evaluation measures the model change. The current caller does not configure prompt caching, Fast mode, streaming, tool calls, or persisted conversations; none needs to be introduced for this migration. If caching is later added, use Astra's documented cache options and billing rules rather than legacy settings.

## Completion record

- Completed: official documentation research, local integration inventory, compatibility assessment, scoped implementation plan, validation gates, staged rollout, and rollback design.
- Validation performed during planning: source inspection and `node --check scripts/senior_review.mjs` on local Node v23.9.0. CI parity testing remains pending under Node 22.x.
- Not performed: provider generation, live model-access verification, runtime edits, secret changes, CI dispatch, or deployment.
- Planning log: [Portfolio GPT-6 Astra migration task](https://app.notion.com/p/3e120186995981fd89b1c559a34a9b93).
