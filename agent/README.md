# Agent skills

Portable instructions so any coding agent can help developers **use Convoy** and **write e2e tests** from natural language.

| Skill | Use when |
|---|---|
| [use-convoy/SKILL.md](use-convoy/SKILL.md) | Install, `init` / `doctor` / `run` / `inspect`, config, platforms, failures |
| [write-e2e-tests/SKILL.md](write-e2e-tests/SKILL.md) | Turn a user journey into `*.e2e.yaml` or `*.e2e.ts` |

## Cursor

Project skills also live under `.cursor/skills/` (same names). They point at these files.

## Other agents

Point the agent at this folder, or copy `agent/` into the app repo after `npm install -D convoy-e2e`. A root `AGENTS.md` should tell the agent to read the matching skill before answering.
