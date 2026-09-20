import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, openaiReview } from './senior_review.mjs';

export const profiles = [
  { model: 'gpt-6-astra', reasoningEffort: 'low', maxOutputTokens: 25000 },
  { model: 'gpt-4o-mini', maxOutputTokens: 1400 },
];

export function hasReviewSections(text) {
  const headings = ['Outcome', 'Findings', 'Refactor Opportunities', 'Residual Risk'];
  let previous = -1;
  return headings.every((heading) => {
    const match = new RegExp(`^## ${heading}\\s*$`, 'm').exec(text);
    if (!match || match.index <= previous) return false;
    previous = match.index;
    return true;
  });
}

// This is an uncached-token estimate at September 20, 2026 Standard rates,
// not an invoice. Preserve raw usage for cache/tier-aware cost reconciliation.
export function estimateCost(model, usage) {
  if (!Number.isFinite(usage?.input_tokens) || !Number.isFinite(usage?.output_tokens)) return null;
  const [inputRate, outputRate] = model === 'gpt-6-astra' ? [10, 50] : [0.15, 0.60];
  return (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1e6;
}

export async function evaluate({ cases, apiKey, review = openaiReview, save = () => {} }) {
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY is required for a live evaluation.');
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 12) {
    throw new Error('Evaluation requires 1 to 12 frozen cases.');
  }
  const result = {
    startedAt: new Date().toISOString(),
    profiles,
    qualityReviewed: false,
    note: 'Transport and Markdown checks are automated. Expected findings require independent review; this is not a quality pass.',
    records: [],
  };
  for (const entry of cases) {
    for (const profile of profiles) {
      const prompt = buildPrompt(entry);
      let record;
      try {
        const response = await review({ apiKey, ...profile, ...prompt, timeoutMs: 120000, maxRetries: 0 });
        record = {
          caseId: entry.id, category: entry.category, clean: entry.clean,
          expectedFindings: entry.expectedFindings,
          ...response,
          formatValid: hasReviewSections(response.text),
          estimatedUncachedCostUsd: estimateCost(profile.model, response.usage),
        };
      } catch (error) {
        record = {
          caseId: entry.id, model: profile.model,
          ...(error.details || {}),
          status: error.details?.status || 'failed',
          error: String(error.message).replaceAll(apiKey, '[REDACTED]'),
          formatValid: false,
        };
      }
      result.records.push(record);
      save(result);
      // Fail early rather than repeatedly billing an inaccessible or incompatible model.
      if (record.status !== 'completed') {
        result.stoppedEarly = true;
        result.stopReason = `${entry.id}: ${profile.model} did not complete`;
        save(result);
        return result;
      }
    }
  }
  result.completedAt = new Date().toISOString();
  result.transportAndFormatPassed = result.records.every((entry) => entry.status === 'completed' && entry.formatValid);
  save(result);
  return result;
}

export function renderSummary(result) {
  return [
    '# Senior reviewer evaluation', '', result.note, '',
    '| Case | Model | Status | Format | Seconds | Estimated uncached USD |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.records.map((record) => `| ${record.caseId} | ${record.model} | ${record.status} | ${record.formatValid ? 'pass' : 'fail'} | ${Number.isFinite(record.durationMs) ? (record.durationMs / 1000).toFixed(1) : 'n/a'} | ${record.estimatedUncachedCostUsd?.toFixed(5) ?? 'n/a'} |`),
    '', result.stopReason || '', '',
    'Full responses, raw usage, and expected findings are in evaluation.json. Synthetic fixtures are release checks, not population-level quality evidence.', '',
    'Rate source: https://developers.openai.com/api/docs/pricing (September 20, 2026). Cache writes, discounts, long context, and tier adjustments are not modeled by the estimate.', '',
  ].join('\n');
}

async function main() {
  const directory = process.env.REVIEW_ARTIFACTS_DIR || 'artifacts/evaluation';
  fs.mkdirSync(directory, { recursive: true });
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/senior-review-evaluation.json', import.meta.url), 'utf8'));
  const result = await evaluate({
    cases: corpus.cases,
    apiKey: process.env.OPENAI_API_KEY,
    save: (value) => {
      fs.writeFileSync(path.join(directory, 'evaluation.json'), `${JSON.stringify(value, null, 2)}\n`);
      fs.writeFileSync(path.join(directory, 'summary.md'), renderSummary(value));
    },
  });
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(result));
  console.log(`Saved ${result.records.length} evaluation responses to ${directory}.`);
  if (!result.transportAndFormatPassed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
