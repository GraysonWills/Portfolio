# Agent System Kit

Starter kit for agentic documentation and role-based skill scaffolding.

Includes:
- Markdown templates for `plan.md`, `agent.md`, `subagent.md`, and supporting docs.
- Three starter skills: `planner-skill`, `executor-skill`, `reviewer-skill`.
- Scripts to initialize and validate doc sets.

## Quick Start

```bash
./agent-system-kit/scripts/init-agent-docs.sh ./docs/agents
./agent-system-kit/scripts/validate-agent-docs.sh ./docs/agents
```

## Output Files

The initializer creates:
- `plan.md`
- `agent.md`
- `subagent.md`
- `handoff.md`
- `decision-log.md`

