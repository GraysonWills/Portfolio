---
name: executor-skill
description: Execute implementation tasks from approved plans and produce agent execution documentation. Use when the user asks to carry out work from plan.md, generate agent.md, produce handoff notes, or track implementation status against milestones.
---

# Executor Skill

Implement tasks from `plan.md` and record execution state in `agent.md`.

## Workflow

1. Read `plan.md` and restate the active milestone.
2. List assumptions before making changes.
3. Execute scoped work only for the active milestone.
4. Run relevant validation steps.
5. Record outputs, evidence, and unresolved risks.
6. Produce a clean handoff for downstream agents.

## Output Contract

- Write operational status to `agent.md`.
- Write transfer details to `handoff.md`.
- Keep status tied to explicit milestones from `plan.md`.

## Templates

- Use `assets/templates/agent.md` for execution reporting.
- Use `assets/templates/handoff.md` for downstream transfer.

