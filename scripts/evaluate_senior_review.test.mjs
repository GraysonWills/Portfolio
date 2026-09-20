import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, estimateCost, hasReviewSections, renderSummary } from './evaluate_senior_review.mjs';

const text = '## Outcome\nReview complete.\n## Findings\nNone.\n## Refactor Opportunities\nNone.\n## Residual Risk\nDiff only.';
const cases = [{ id: 'clean', category: 'cosmetic', changedFiles: ['readme.md'], diffText: '+Hello', expectedFindings: [], clean: true }];

test('evaluates identical prompts under both profiles without claiming quality acceptance', async () => {
  const calls = [];
  let saves = 0;
  const result = await evaluate({ cases, apiKey: 'fake-key', save: () => { saves++; }, review: async (request) => {
    calls.push(request);
    return { model: request.model, status: 'completed', text, usage: { input_tokens: 100, output_tokens: 100 }, durationMs: 1000 };
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].user, calls[1].user);
  assert.equal(calls[0].system, calls[1].system);
  assert.equal(calls[0].maxRetries, 0);
  assert.equal(result.transportAndFormatPassed, true);
  assert.equal(result.qualityReviewed, false);
  assert.equal(saves, 3);
  assert.match(renderSummary(result), /Expected findings require independent review/);
});

test('stops on first provider failure, persists evidence and redacts API key', async () => {
  let calls = 0;
  const result = await evaluate({ cases, apiKey: 'fake-key', review: async () => {
    calls++;
    throw Object.assign(new Error('Access denied fake-key'), { details: { status: 'failed', httpStatus: 403 } });
  } });
  assert.equal(calls, 1);
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.records[0].httpStatus, 403);
  assert.doesNotMatch(JSON.stringify(result), /fake-key/);
});

test('format checks require ordered headings, cost estimates require usage', () => {
  assert.equal(hasReviewSections(text), true);
  assert.equal(hasReviewSections(text.replace('## Findings', 'Findings')), false);
  assert.equal(hasReviewSections('## Findings\n## Outcome\n## Refactor Opportunities\n## Residual Risk'), false);
  assert.equal(estimateCost('gpt-6-astra', { input_tokens: 20000, output_tokens: 5000 }), 0.45);
  assert.equal(estimateCost('gpt-6-astra', {}), null);
});

test('requires a key and a bounded corpus before provider calls', async () => {
  await assert.rejects(evaluate({ cases, apiKey: '' }), /required/);
  await assert.rejects(evaluate({ cases: Array(13).fill(cases[0]), apiKey: 'fake-key' }), /1 to 12/);
});
