import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPrompt, getReviewConfig, main, openaiReview } from './senior_review.mjs';

const API_KEY = 'sk-test-private-credential';
const completed = (text = '## Outcome\nReview complete.\n## Findings\nNone.\n## Refactor Opportunities\nNone.\n## Residual Risk\nUntested runtime.') => ({
  id: 'resp_test', model: 'gpt-6-astra-2026-test', status: 'completed',
  output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 100, output_tokens: 60, total_tokens: 160, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 40 } },
});
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'x-request-id': 'req_test' } });
const requestOptions = (extra = {}) => ({ apiKey: API_KEY, ...getReviewConfig({}), system: 'system prompt', user: 'user prompt', sleep: async () => {}, ...extra });

function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'senior-review-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '--quiet');
  fs.writeFileSync(path.join(cwd, 'example.js'), 'const before = true;\n');
  git('add', 'example.js');
  git('-c', 'user.name=Reviewer Test', '-c', 'user.email=reviewer@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(cwd, 'example.js'), `const after = true;\n${'// changed line\n'.repeat(30)}`);
  git('add', 'example.js');
  git('-c', 'user.name=Reviewer Test', '-c', 'user.email=reviewer@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'head');
  return { cwd, base, head: git('rev-parse', 'HEAD') };
}

function mainOptions(repo, env = {}, fetchImpl) {
  return { cwd: repo.cwd, env: { REVIEW_BASE_SHA: repo.base, REVIEW_HEAD_SHA: repo.head, ...env }, stdout: { write() {} }, sleep: async () => {}, fetchImpl };
}

function artifact(repo, filename) {
  return fs.readFileSync(path.join(repo.cwd, 'artifacts', filename), 'utf8');
}

test('configuration defaults to Astra and preserves explicit model and legacy rollback', () => {
  assert.deepEqual(getReviewConfig({}), { model: 'gpt-6-astra', reasoningEffort: 'low', maxOutputTokens: 25000, timeoutMs: 120000, maxRetries: 1 });
  assert.equal(getReviewConfig({ OPENAI_REVIEW_MODEL: '  gpt-6-astra-snapshot  ', OPENAI_REVIEW_REASONING_EFFORT: 'medium', OPENAI_REVIEW_MAX_TOKENS: '40000' }).maxOutputTokens, 40000);
  const legacy = getReviewConfig({ OPENAI_REVIEW_MODEL: 'gpt-4o-mini', OPENAI_REVIEW_REASONING_EFFORT: 'low', OPENAI_REVIEW_MAX_TOKENS: '' });
  assert.equal(legacy.model, 'gpt-4o-mini');
  assert.equal(legacy.reasoningEffort, null);
  assert.equal(legacy.maxOutputTokens, 1400);
  assert.equal(getReviewConfig({ OPENAI_REVIEW_REASONING_EFFORT: ' ' }).reasoningEffort, 'low');
});

test('configuration rejects malformed numeric settings and unverified effort values', () => {
  for (const [key, value] of Object.entries({ OPENAI_REVIEW_MAX_TOKENS: '1400tokens', OPENAI_REVIEW_TIMEOUT_MS: '-1', OPENAI_REVIEW_MAX_RETRIES: '4', OPENAI_REVIEW_REASONING_EFFORT: 'ultra', OPENAI_REVIEW_MODEL: 'gpt model' })) {
    assert.throws(() => getReviewConfig({ [key]: value }), new RegExp(key));
  }
  assert.equal(getReviewConfig({ OPENAI_REVIEW_MAX_RETRIES: '0' }).maxRetries, 0);
});

test('Astra request uses Responses with reasoning and no unsupported sampling fields', async () => {
  let calls = 0;
  const result = await openaiReview(requestOptions({ fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(options.body), { model: 'gpt-6-astra', input: [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'user prompt' }], max_output_tokens: 25000, reasoning: { effort: 'low' } });
    return response(completed());
  } }));
  assert.equal(calls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.model, 'gpt-6-astra-2026-test');
  assert.equal(result.requestedModel, 'gpt-6-astra');
  assert.equal(result.requestId, 'req_test');
  assert.equal(result.responseId, 'resp_test');
  assert.equal(result.usage.output_tokens_details.reasoning_tokens, 40);
  assert.equal(result.attempts, 1);
  assert.match(result.text, /## Findings/);
  assert.ok(result.durationMs >= 0);
});

test('legacy profile keeps temperature, baseline cap, and no reasoning field', async () => {
  await openaiReview(requestOptions({ ...getReviewConfig({ OPENAI_REVIEW_MODEL: 'gpt-4o-mini' }), fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_output_tokens, 1400);
    assert.ok(!('reasoning' in body));
    return response({ ...completed(), model: 'gpt-4o-mini' });
  } }));
});

test('all text items after reasoning are read in order', async () => {
  const body = completed(' first ');
  body.output.push({ type: 'message', content: [{ type: 'output_text', text: 'second' }] });
  const result = await openaiReview(requestOptions({ fetchImpl: async () => response(body) }));
  assert.equal(result.text, 'first \nsecond');
});

for (const [label, body, status, code] of [
  ['incomplete', { ...completed('partial'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'incomplete', 'incomplete_response'],
  ['refusal', { ...completed(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot review' }] }] }, 'refused', 'refusal'],
  ['failed', { ...completed(), status: 'failed', error: { code: 'server_error', message: 'Model failed' } }, 'failed', 'response_not_completed'],
  ['missing status', { output: completed().output }, 'failed', 'response_not_completed'],
  ['empty', completed(' '), 'failed', 'empty_response'],
  ['reasoning only', { ...completed(), output: [{ type: 'reasoning', summary: [] }] }, 'failed', 'empty_response'],
  ['malformed JSON', '{bad JSON', 'failed', 'malformed_response'],
  ['malformed message', { ...completed(), output: [{ type: 'message', content: 'bad' }] }, 'failed', 'malformed_response'],
]) {
  test(`${label} response cannot become a successful review or trigger fallback`, async () => {
    let calls = 0;
    await assert.rejects(openaiReview(requestOptions({ fetchImpl: async () => { calls += 1; return response(body); } })), (error) => {
      assert.equal(error.details.status, status);
      assert.equal(error.details.code, code);
      assert.equal(error.details.requestId, 'req_test');
      if (label === 'incomplete') assert.equal(error.details.incompleteReason, 'max_output_tokens');
      return true;
    });
    assert.equal(calls, 1);
  });
}

for (const httpStatus of [400, 401]) {
  test(`HTTP ${httpStatus} preserves sanitized provider error without retry`, async () => {
    let calls = 0;
    await assert.rejects(openaiReview(requestOptions({ fetchImpl: async () => {
      calls += 1;
      return response({ error: { code: 'invalid_request', param: 'model', message: `invalid key ${API_KEY} ${'x'.repeat(1000)}` } }, httpStatus);
    } })), (error) => {
      assert.equal(error.details.httpStatus, httpStatus);
      assert.equal(error.details.providerError.code, 'invalid_request');
      assert.equal(error.details.providerError.param, 'model');
      assert.equal(error.details.attempts, 1);
      assert.ok(!JSON.stringify(error.details).includes(API_KEY));
      assert.ok(!error.message.includes(API_KEY));
      assert.ok(error.details.providerError.message.length <= 500);
      return true;
    });
    assert.equal(calls, 1);
  });
}

for (const httpStatus of [429, 500, 503]) {
  test(`HTTP ${httpStatus} retries once on the same endpoint then succeeds`, async () => {
    let calls = 0;
    const delays = [];
    const result = await openaiReview(requestOptions({ sleep: async (ms) => delays.push(ms), fetchImpl: async (url) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      calls += 1;
      return calls === 1 ? response({ error: { message: 'temporary failure' } }, httpStatus) : response(completed());
    } }));
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.deepEqual(delays, [1000]);
  });
}

test('repeated provider errors exhaust bounded retries without model or endpoint fallback', async () => {
  let calls = 0;
  await assert.rejects(openaiReview(requestOptions({ fetchImpl: async () => { calls += 1; return response({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429); } })), (error) => {
    assert.equal(error.details.attempts, 2);
    assert.equal(error.details.httpStatus, 429);
    assert.equal(error.details.providerError.code, 'rate_limit_exceeded');
    return true;
  });
  assert.equal(calls, 2);
});

test('Retry-After seconds are honored without the fallback backoff cap', async () => {
  let calls = 0;
  const delays = [];
  const result = await openaiReview(requestOptions({ sleep: async (ms) => delays.push(ms), fetchImpl: async () => {
    calls += 1;
    if (calls > 1) return response(completed());
    const limited = response({ error: { message: 'rate limited' } }, 429);
    limited.headers.set('retry-after', '30');
    return limited;
  } }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(delays, [30000]);
});

test('Retry-After HTTP date is honored', async () => {
  let calls = 0;
  const delays = [];
  const retryDate = new Date(Date.now() + 60000).toUTCString();
  await openaiReview(requestOptions({ sleep: async (ms) => delays.push(ms), fetchImpl: async () => {
    calls += 1;
    if (calls > 1) return response(completed());
    const limited = response({ error: { message: 'rate limited' } }, 429);
    limited.headers.set('retry-after', retryDate);
    return limited;
  } }));
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 58000 && delays[0] <= 60000);
});

test('Retry-After beyond the deadline preserves the provider failure without retrying', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(openaiReview(requestOptions({ timeoutMs: 10000, sleep: async (ms) => delays.push(ms), fetchImpl: async () => {
    calls += 1;
    const limited = response({ error: { code: 'rate_limit_exceeded', message: 'rate limited' } }, 429);
    limited.headers.set('retry-after', '30');
    return limited;
  } })), (error) => error.details.httpStatus === 429 && error.details.providerError.code === 'rate_limit_exceeded');
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('network ambiguity is not automatically retried', async () => {
  let calls = 0;
  await assert.rejects(openaiReview(requestOptions({ fetchImpl: async () => { calls += 1; throw new Error('socket closed'); } })), (error) => error.details.code === 'network_error');
  assert.equal(calls, 1);
});

test('deadline aborts a stalled fetch and does not retry', async () => {
  let signal;
  let calls = 0;
  await assert.rejects(openaiReview(requestOptions({ timeoutMs: 10, fetchImpl: async (_url, options) => { calls += 1; signal = options.signal; return new Promise(() => {}); } })), (error) => error.details.code === 'timeout' && error.details.attempts === 1);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('deadline also covers stalled response body consumption', async () => {
  await assert.rejects(openaiReview(requestOptions({ timeoutMs: 10, fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) }) })), (error) => error.details.code === 'timeout');
});

test('prompt retains original sections and finding evidence requirements', () => {
  const prompt = buildPrompt({ changedFiles: ['example.js'], diffText: '-before\n+after' });
  for (const heading of ['## Outcome', '## Findings', '## Refactor Opportunities', '## Residual Risk']) assert.ok(prompt.system.includes(heading));
  assert.match(prompt.system, /evidence from the diff, and a concrete suggested fix/);
  assert.match(prompt.user, /- example.js/);
  assert.match(prompt.user, /```diff\n-before\n\+after\n```/);
});

test('missing key emits skipped artifacts, GitHub summary, and output without a request', async (t) => {
  const repo = repository(t);
  const summary = path.join(repo.cwd, 'summary.md');
  const output = path.join(repo.cwd, 'outputs');
  const result = await main(mainOptions(repo, { GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output }, async () => { throw new Error('must not call provider'); }));
  assert.equal(result.status, 'skipped');
  assert.equal(result.attempts, 0);
  const stored = JSON.parse(artifact(repo, 'senior-review-result.json'));
  assert.equal(stored.status, 'skipped');
  assert.equal(stored.base, repo.base);
  assert.equal(stored.head, repo.head);
  assert.match(artifact(repo, 'senior-review-report.md'), /OPENAI_API_KEY.*not configured/);
  assert.ok(artifact(repo, 'senior-review-pr-comment.md').startsWith('<!-- senior-review -->'));
  assert.match(fs.readFileSync(summary, 'utf8'), /\*\*skipped\*\*/);
  assert.match(fs.readFileSync(output, 'utf8'), /review_status=skipped/);
});

test('successful main preserves diff and comment bounds and records telemetry separately', async (t) => {
  const repo = repository(t);
  const review = `${completed().output[1].content[0].text}\n${'finding '.repeat(2000)}`;
  const result = await main(mainOptions(repo, { OPENAI_API_KEY: API_KEY, REVIEW_MAX_DIFF_CHARS: '120' }, async (_url, options) => {
    assert.match(JSON.parse(options.body).input[1].content, /TRUNCATED: diff exceeded 120 characters/);
    return response(completed(review));
  }));
  assert.equal(result.status, 'completed');
  assert.equal(result.diffTruncated, true);
  assert.deepEqual(result.changedFiles, ['example.js']);
  assert.match(artifact(repo, 'senior-review-report.md'), /## Residual Risk/);
  assert.match(artifact(repo, 'senior-review-pr-comment.md'), /TRUNCATED: review exceeded 9000 characters/);
  assert.ok(artifact(repo, 'senior-review-pr-comment.md').length < 10000);
  const json = artifact(repo, 'senior-review-result.json');
  assert.ok(!json.includes(API_KEY));
  assert.ok(!json.includes('const after'));
  assert.ok(!json.includes('finding finding'));
  assert.equal(JSON.parse(json).usage.input_tokens, 100);
});

test('provider failure remains advisory unless success is required, with artifacts in both cases', async (t) => {
  const repo = repository(t);
  const invoke = (requireSuccess) => main(mainOptions(repo, { OPENAI_API_KEY: API_KEY, REVIEW_REQUIRE_SUCCESS: requireSuccess }, async () => response({ ...completed(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })));
  assert.equal((await invoke('false')).status, 'incomplete');
  await assert.rejects(invoke('true'), (error) => error.details.status === 'incomplete');
  assert.equal(JSON.parse(artifact(repo, 'senior-review-result.json')).status, 'incomplete');
  assert.match(artifact(repo, 'senior-review-report.md'), /AI review incomplete/);
});

test('invalid configuration is visibly failed and never reaches the API', async (t) => {
  const repo = repository(t);
  const result = await main(mainOptions(repo, { OPENAI_API_KEY: API_KEY, OPENAI_REVIEW_MAX_TOKENS: 'invalid' }, async () => { throw new Error('must not call provider'); }));
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'invalid_configuration');
  assert.match(artifact(repo, 'senior-review-report.md'), /OPENAI_REVIEW_MAX_TOKENS/);
});

test('invalid git reference fails without executing shell commands or reviewing an empty diff', async (t) => {
  const repo = repository(t);
  const maliciousRef = '$(touch injected)';
  const result = await main(mainOptions(repo, { OPENAI_API_KEY: API_KEY, REVIEW_BASE_SHA: maliciousRef }, async () => { throw new Error('must not call provider'); }));
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'input_error');
  assert.equal(fs.existsSync(path.join(repo.cwd, 'injected')), false);
});

test('import is side-effect free in a fresh process', (t) => {
  const repo = repository(t);
  const modulePath = fileURLToPath(new URL('./senior_review.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(modulePath)})`], { cwd: repo.cwd, encoding: 'utf8' });
  assert.equal(output, '');
  assert.equal(fs.existsSync(path.join(repo.cwd, 'artifacts')), false);
});
