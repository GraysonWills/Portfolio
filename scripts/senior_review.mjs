import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const EFFORTS = new Set(['low', 'medium', 'high']);

function legacyModel(model) {
  return /^gpt-4(?:o|\.|$)/.test(model);
}

function integerSetting(value, name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(text);
}

export function getReviewConfig(env = process.env) {
  const model = env.OPENAI_REVIEW_MODEL?.trim() || 'gpt-6-astra';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(model)) throw new Error('OPENAI_REVIEW_MODEL must be a valid model identifier');
  const legacy = legacyModel(model);
  const effort = env.OPENAI_REVIEW_REASONING_EFFORT?.trim() || 'low';
  if (!EFFORTS.has(effort)) throw new Error('OPENAI_REVIEW_REASONING_EFFORT must be low, medium, or high');
  return {
    model,
    reasoningEffort: legacy ? null : effort,
    maxOutputTokens: integerSetting(env.OPENAI_REVIEW_MAX_TOKENS, 'OPENAI_REVIEW_MAX_TOKENS', legacy ? 1400 : 25000),
    timeoutMs: integerSetting(env.OPENAI_REVIEW_TIMEOUT_MS, 'OPENAI_REVIEW_TIMEOUT_MS', 120000, 1, 600000),
    maxRetries: integerSetting(env.OPENAI_REVIEW_MAX_RETRIES, 'OPENAI_REVIEW_MAX_RETRIES', 1, 0, 3),
  };
}

function sanitize(value, apiKey = '', max = 500) {
  let text = String(value ?? '');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]').slice(0, max);
}

function usageDetails(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const result = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isFinite(usage[key]) && usage[key] >= 0) result[key] = usage[key];
  }
  for (const [key, field] of [['input_tokens_details', 'cached_tokens'], ['output_tokens_details', 'reasoning_tokens']]) {
    if (Number.isFinite(usage[key]?.[field]) && usage[key][field] >= 0) result[key] = { [field]: usage[key][field] };
  }
  return result;
}

function providerError(json, apiKey) {
  if (!json?.error || typeof json.error !== 'object') return null;
  const error = {};
  for (const field of ['type', 'code', 'param', 'message']) {
    if (typeof json.error[field] === 'string') error[field] = sanitize(json.error[field], apiKey);
  }
  return error;
}

function parseResponsesText(json) {
  if (!Array.isArray(json?.output)) return { text: '', malformed: true, refused: false };
  const parts = [];
  let refused = false;
  for (const message of json.output) {
    if (message?.type !== 'message') continue;
    if (!Array.isArray(message.content)) return { text: '', malformed: true, refused: false };
    for (const item of message.content) {
      if (item?.type === 'refusal') refused = true;
      if (item?.type === 'output_text') {
        if (typeof item.text !== 'string') return { text: '', malformed: true, refused };
        parts.push(item.text);
      }
    }
  }
  return { text: parts.join('\n').trim(), malformed: false, refused };
}

export async function openaiReview({ apiKey, model, system, user, maxOutputTokens, reasoningEffort = 'low', timeoutMs = 120000, maxRetries = 1, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const started = Date.now();
  const legacy = legacyModel(model);
  const request = {
    model,
    input: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_output_tokens: maxOutputTokens,
    ...(legacy ? { temperature: 0.2 } : { reasoning: { effort: reasoningEffort } }),
  };
  const telemetry = {
    model, requestedModel: model, reasoningEffort: legacy ? null : reasoningEffort,
    maxOutputTokens, usage: null, requestId: null, responseId: null,
    attempts: 0, endpoint: ENDPOINT, httpStatus: null,
  };
  const failure = (message, code, status = 'failed', extra = {}) => {
    const err = new Error(sanitize(message, apiKey));
    err.details = { ...telemetry, status, code, ...extra, durationMs: Date.now() - started };
    return err;
  };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw failure('OpenAI review exceeded its request deadline', 'timeout');
    telemetry.attempts += 1;
    const controller = new AbortController();
    let timer;
    let response;
    let json;
    try {
      const call = async () => {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        telemetry.httpStatus = response.status;
        telemetry.requestId = sanitize(response.headers?.get?.('x-request-id'), apiKey, 200) || null;
        // Parse inside the deadline: a stalled response body must also time out.
        try { json = JSON.parse(await response.text()); } catch (err) {
          if (controller.signal.aborted) throw err;
          json = null;
        }
      };
      await Promise.race([
        call(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          reject(failure('OpenAI review exceeded its request deadline', 'timeout'));
        }, remaining); }),
      ]);
    } catch (err) {
      if (err?.details) throw err;
      throw failure(controller.signal.aborted ? 'OpenAI review exceeded its request deadline' : `OpenAI request failed: ${sanitize(err?.message ?? err, apiKey)}`, controller.signal.aborted ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const originalError = providerError(json, apiKey);
      const error = failure(`OpenAI API request failed (${response.status})${originalError?.message ? `: ${originalError.message}` : ''}`, 'provider_error', 'failed', { providerError: originalError });
      if ((response.status === 429 || response.status >= 500 && response.status <= 599) && attempt < maxRetries) {
        const retryAfter = response.headers?.get?.('retry-after')?.trim();
        const retryAfterMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
        const fallbackDelay = Math.min(5000, 1000 * 2 ** attempt);
        const delay = Math.max(fallbackDelay, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
        if (Date.now() - started + delay >= timeoutMs) throw error;
        await sleep(delay);
        continue;
      }
      throw error;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw failure('OpenAI returned a malformed JSON response', 'malformed_response');
    telemetry.responseId = sanitize(json.id, apiKey, 200) || null;
    telemetry.model = typeof json.model === 'string' ? sanitize(json.model, apiKey, 200) : model;
    telemetry.usage = usageDetails(json.usage);
    if (json.status === 'incomplete') throw failure('OpenAI review was incomplete', 'incomplete_response', 'incomplete', { incompleteReason: sanitize(json.incomplete_details?.reason, apiKey, 200) || null });
    if (json.status !== 'completed') throw failure(`OpenAI review did not complete (status: ${sanitize(json.status ?? 'missing', apiKey, 100)})`, 'response_not_completed', 'failed', { providerStatus: sanitize(json.status, apiKey, 100) || null, providerError: providerError(json, apiKey) });
    const parsed = parseResponsesText(json);
    if (parsed.refused) throw failure('OpenAI declined to produce the review', 'refusal', 'refused');
    if (parsed.malformed) throw failure('OpenAI returned malformed review output', 'malformed_response');
    if (!parsed.text) throw failure('OpenAI returned an empty review', 'empty_response');
    return { text: parsed.text, status: 'completed', ...telemetry, durationMs: Date.now() - started };
  }
  throw failure('OpenAI review did not run', 'invalid_configuration');
}

function truncate(str, maxChars, label = 'diff') {
  if (str.length <= maxChars) return { text: str, truncated: false };
  return { text: `${str.slice(0, maxChars)}\n\n[TRUNCATED: ${label} exceeded ${maxChars} characters]`, truncated: true };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}
export function buildPrompt({ changedFiles, diffText }) {
  const system = [
    'You are a senior software engineer doing a rigorous, industry-standard code review.',
    'Priorities: correctness, maintainability, clarity, testability, performance, security hygiene.',
    'Principles: DRY, SOLID (when appropriate), KISS, YAGNI, clean architecture boundaries.',
    'Be pragmatic: avoid over-engineering; suggest abstractions/factory patterns only when justified.',
    '',
    'Output format (strict):',
    '- Start with "## Outcome" and "## Findings".',
    '- Findings must be a numbered list with severity tags [P0]-[P3].',
    '- Each finding must include: file(s), evidence from the diff, and a concrete suggested fix.',
    '- After findings, include "## Refactor Opportunities" and "## Residual Risk".',
  ].join('\n');

  const user = [
    'Review the following commit diff.',
    '',
    'Changed files:',
    ...changedFiles.map((f) => `- ${f}`),
    '',
    'Diff:',
    '```diff',
    diffText,
    '```',
  ].join('\n');

  return { system, user };
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, sleep, cwd = process.cwd(), stdout = process.stdout } = {}) {
  const artifactsDir = path.resolve(cwd, env.REVIEW_ARTIFACTS_DIR || 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const apiKey = env.OPENAI_API_KEY?.trim();
  const started = Date.now();
  let config;
  let base = '';
  let head = '';
  let changedFiles = [];
  let rawDiff = '';
  let diffText = '[no diff produced]';
  let diffTruncated = false;
  let maxDiffChars = 180000;
  let reviewText = '';
  let result;
  try {
    config = getReviewConfig(env);
    maxDiffChars = integerSetting(env.REVIEW_MAX_DIFF_CHARS, 'REVIEW_MAX_DIFF_CHARS', 180000);
    const baseRef = env.REVIEW_BASE_SHA?.trim();
    head = git(['rev-parse', '--verify', '--end-of-options', `${env.REVIEW_HEAD_SHA?.trim() || 'HEAD'}^{commit}`], cwd);
    base = git(['rev-parse', '--verify', '--end-of-options', `${baseRef && !/^0+$/.test(baseRef) ? baseRef : 'HEAD~1'}^{commit}`], cwd);
    changedFiles = git(['diff', '--name-only', base, head, '--'], cwd).split('\n').filter(Boolean);
    rawDiff = git(['diff', '--no-color', base, head, '--'], cwd);
    ({ text: diffText, truncated: diffTruncated } = truncate(rawDiff || '[no diff produced]', maxDiffChars));
    if (!apiKey) {
      result = { status: 'skipped', code: 'missing_api_key', model: config.model, requestedModel: config.model, reasoningEffort: config.reasoningEffort, maxOutputTokens: config.maxOutputTokens, attempts: 0, endpoint: ENDPOINT, durationMs: 0, usage: null, requestId: null, responseId: null };
    } else {
      const response = await openaiReview({ apiKey, ...config, ...buildPrompt({ changedFiles, diffText }), fetchImpl, sleep });
      ({ text: reviewText, ...result } = response);
    }
  } catch (err) {
    result = {
      status: 'failed', code: config ? 'input_error' : 'invalid_configuration',
      model: config?.model ?? null, requestedModel: config?.model ?? null,
      reasoningEffort: config?.reasoningEffort ?? null, maxOutputTokens: config?.maxOutputTokens ?? null,
      attempts: 0, endpoint: ENDPOINT, durationMs: Date.now() - started,
      usage: null, requestId: null, responseId: null,
      ...err?.details, error: sanitize(err?.message ?? err, apiKey),
    };
  }
  result = { ...result, base, head, changedFiles, inputChars: rawDiff.length, diffTruncated, maxDiffChars };
  const metadata = [
    `- Base: \`${base}\``, `- Head: \`${head}\``, `- Files changed: ${changedFiles.length}`,
    diffTruncated ? `- Diff: truncated to ${maxDiffChars} chars` : '- Diff: full',
    `- Model: \`${result.model || 'unconfigured'}\``, `- Reasoning effort: ${result.reasoningEffort || 'not applicable'}`,
    `- Review status: **${result.status}**`,
  ].join('\n');
  const outcome = result.status === 'skipped'
    ? 'AI review skipped: `OPENAI_API_KEY` not configured in repo secrets.'
    : reviewText || `AI review ${result.status}: ${result.error || 'unknown error'}`;
  const reportPath = path.join(artifactsDir, 'senior-review-report.md');
  const commentPath = path.join(artifactsDir, 'senior-review-pr-comment.md');
  const resultPath = path.join(artifactsDir, 'senior-review-result.json');
  const report = [
    '# Senior Engineer Review', '', '## Context', metadata, '', '## Changed Files',
    ...(changedFiles.length ? changedFiles.map((file) => `- ${file}`) : ['- (none detected)']),
    '', '## Review', outcome, '', '## Diff (for reference)', '```diff', diffText, '```', '',
  ];
  fs.writeFileSync(reportPath, `${report.join('\n')}\n`, 'utf8');
  const comment = [
    '<!-- senior-review -->', '## Senior Engineer Review', '', metadata, '',
    result.status === 'skipped' ? 'AI review skipped (no `OPENAI_API_KEY` configured). See workflow artifacts for the full report.' : truncate(outcome, 9000, 'review').text,
    ...(reviewText ? ['', '_Full report is attached as a workflow artifact._'] : []),
  ];
  fs.writeFileSync(commentPath, `${comment.join('\n')}\n`, 'utf8');
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Senior Engineer Review\n\n${metadata}\n- Attempts: ${result.attempts}\n- Duration: ${result.durationMs} ms\n${result.error ? `- Error: ${result.error}\n` : ''}\n`);
  }
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `review_status=${result.status}\nreview_model=${String(result.model || '').replace(/[\r\n]/g, '')}\nreview_attempts=${result.attempts}\n`);
  }
  stdout.write(`Wrote review report: ${reportPath}\nWrote PR comment body: ${commentPath}\nReview status: ${result.status}\n`);
  if (env.REVIEW_REQUIRE_SUCCESS?.trim().toLowerCase() === 'true' && result.status !== 'completed') {
    const err = new Error(`Required AI review did not complete (status: ${result.status})`);
    err.details = result;
    throw err;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
