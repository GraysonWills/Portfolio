---
name: planner-skill
description: Create and maintain execution plans for coding and operations tasks. Use when the user asks for planning artifacts like plan.md, milestones, scope boundaries, constraints, risk registers, or acceptance criteria before implementation.
---

# Planner Skill

Produce a complete `plan.md` before implementation work starts.

## Workflow

1. Confirm objective and expected end state in one sentence.
2. Define in-scope and out-of-scope boundaries.
3. Capture constraints, dependencies, and assumptions.
4. Break work into ordered milestones with explicit validation steps.
5. Record risks and mitigations.
6. Define acceptance criteria as verifiable checks.

## Output Contract

- Write to `plan.md`.
- Include these sections exactly:
  - `# Plan`
  - `## Objective`
  - `## Scope`
  - `## Constraints`
  - `## Inputs`
  - `## Milestones`
  - `## Risks`
  - `## Acceptance Criteria`

## Templates

- Use `assets/templates/plan.md` as the default starting point.
- Use `assets/templates/decision-log.md` to capture key planning decisions.

