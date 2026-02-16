---
name: reviewer-skill
description: Review plans and implementation outputs for correctness, risk, and completeness. Use when the user asks to audit plan.md or agent.md, produce subagent.md assignments, identify regressions, or create a review report with prioritized findings.
---

# Reviewer Skill

Evaluate artifacts for quality and assign follow-up actions.

## Workflow

1. Read `plan.md`, `agent.md`, and `handoff.md` if available.
2. Check alignment between objective, work performed, and evidence.
3. Identify defects, missing validation, or scope drift.
4. Assign bounded follow-up tasks in `subagent.md`.
5. Produce a concise review summary with prioritized findings.

## Output Contract

- Write delegated work to `subagent.md`.
- Ensure each subagent task has:
  - clear boundary
  - required inputs
  - explicit output contract
  - failure handling instructions

## Templates

- Use `assets/templates/subagent.md` for delegation.
- Use `assets/templates/review-report.md` for final review summaries.

