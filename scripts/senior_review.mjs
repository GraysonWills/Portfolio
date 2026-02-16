import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}

function safeSh(cmd, opts = {}) {
  try {
    return { ok: true, out: sh(cmd, opts) };
  } catch (err) {
    const stderr = err?.stderr?.toString?.() ?? '';
    return { ok: false, out: '', err: String(err?.message ?? err), stderr };
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function truncate(str, maxChars) {
  if (str.length <= maxChars) return { text: str, truncated: false };
  return {
    text: `${str.slice(0, maxChars)}\n\n[TRUNCATED: diff exceeded ${maxChars} characters]`,
    truncated: true,
  };
}

function parseResponsesText(json) {
  const output = Array.isArray(json?.output) ? json.output : [];
  const parts = [];
  for (const message of output) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      if (item?.type === 'output_text' && typeof item?.text === 'string') {
        parts.push(item.text);
      }
    }
  }
  return parts.join('\n').trim();
}

async function openaiReview({ apiKey, model, system, user, maxOutputTokens }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Prefer the Responses API, fall back to Chat Completions.
  const responsesBody = {
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_output_tokens: maxOutputTokens,
  };

  const responsesResp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify(responsesBody),
  });

  if (responsesResp.ok) {
    const json = await responsesResp.json();
    const text = parseResponsesText(json);
    if (text) return text;
    // If schema changes, still fall back.
  }

  const chatBody = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: maxOutputTokens,
  };

  const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(chatBody),
  });

  if (!chatResp.ok) {
    const text = await chatResp.text();
    throw new Error(`OpenAI API request failed (${chatResp.status}): ${text.slice(0, 500)}`);
  }

  const json = await chatResp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI API returned empty response');
  }
  return content.trim();
}

function buildPrompt({ changedFiles, diffText }) {
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

async function main() {
  const artifactsDir = process.env.REVIEW_ARTIFACTS_DIR || 'artifacts';
  ensureDir(artifactsDir);

  const baseSha = process.env.REVIEW_BASE_SHA?.trim();
  const headSha = process.env.REVIEW_HEAD_SHA?.trim();

  const head = headSha || safeSh('git rev-parse HEAD').out;
  const base = baseSha && !/^0+$/.test(baseSha.replace(/[^0-9a-f]/gi, '')) ? baseSha : safeSh('git rev-parse HEAD~1').out;

  const changedFilesResult = safeSh(`git diff --name-only ${base} ${head}`);
  const changedFiles = changedFilesResult.ok && changedFilesResult.out
    ? changedFilesResult.out.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];

  const diffResult = safeSh(`git diff --no-color ${base} ${head}`);
  const rawDiff = diffResult.ok ? diffResult.out : '';

  const maxDiffChars = parseInt(process.env.REVIEW_MAX_DIFF_CHARS || '180000', 10);
  const { text: diffText, truncated: diffTruncated } = truncate(rawDiff || '[no diff produced]', maxDiffChars);

  const metadata = [
    `- Base: \`${base}\``,
    `- Head: \`${head}\``,
    `- Files changed: ${changedFiles.length}`,
    diffTruncated ? `- Diff: truncated to ${maxDiffChars} chars` : `- Diff: full`,
  ].join('\n');

  const reportPath = path.join(artifactsDir, 'senior-review-report.md');
  const commentPath = path.join(artifactsDir, 'senior-review-pr-comment.md');

  let reviewText = '';
  let reviewError = '';

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = (process.env.OPENAI_REVIEW_MODEL || 'gpt-4o-mini').trim();
  const maxOutputTokens = parseInt(process.env.OPENAI_REVIEW_MAX_TOKENS || '1400', 10);

  if (apiKey) {
    const { system, user } = buildPrompt({ changedFiles, diffText });
    try {
      reviewText = await openaiReview({
        apiKey,
        model,
        system,
        user,
        maxOutputTokens,
      });
    } catch (err) {
      reviewError = String(err?.message ?? err);
    }
  }

  const reportLines = [];
  reportLines.push('# Senior Engineer Review');
  reportLines.push('');
  reportLines.push('## Context');
  reportLines.push(metadata);
  reportLines.push('');
  reportLines.push('## Changed Files');
  if (changedFiles.length === 0) {
    reportLines.push('- (none detected)');
  } else {
    for (const f of changedFiles) reportLines.push(`- ${f}`);
  }
  reportLines.push('');
  reportLines.push('## Review');
  if (!apiKey) {
    reportLines.push('AI review skipped: `OPENAI_API_KEY` not configured in repo secrets.');
  } else if (reviewText) {
    reportLines.push(reviewText);
  } else {
    reportLines.push(`AI review failed: ${reviewError || 'unknown error'}`);
  }
  reportLines.push('');
  reportLines.push('## Diff (for reference)');
  reportLines.push('```diff');
  reportLines.push(diffText);
  reportLines.push('```');
  reportLines.push('');

  fs.writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  // PR comment: keep it short and updateable.
  const commentLines = [];
  commentLines.push('<!-- senior-review -->');
  commentLines.push('## Senior Engineer Review');
  commentLines.push('');
  commentLines.push(metadata);
  commentLines.push('');
  if (!apiKey) {
    commentLines.push('AI review skipped (no `OPENAI_API_KEY` configured). See workflow artifacts for the full report.');
  } else if (reviewText) {
    // GitHub comments have size limits; keep it bounded.
    const maxCommentChars = 9000;
    const { text: shortReview } = truncate(reviewText, maxCommentChars);
    commentLines.push(shortReview);
    commentLines.push('');
    commentLines.push('_Full report is attached as a workflow artifact._');
  } else {
    commentLines.push(`AI review failed: ${reviewError || 'unknown error'}`);
  }

  fs.writeFileSync(commentPath, `${commentLines.join('\n')}\n`, 'utf8');

  // Also emit a small stdout note for logs.
  process.stdout.write(`Wrote review report: ${reportPath}\n`);
  process.stdout.write(`Wrote PR comment body: ${commentPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

