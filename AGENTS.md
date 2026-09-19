# Agent instructions

Convoy is semantic e2e for iOS, Android, and web (`convoy-e2e`, CLI `convoy`). Authors describe what a human sees — no selectors, IDs, or explicit waits.

Before answering, read the matching skill:

| Topic | Skill |
|---|---|
| Install, configure, run, inspect, debug | [agent/use-convoy/SKILL.md](agent/use-convoy/SKILL.md) |
| Natural-language flow → YAML or TypeScript test | [agent/write-e2e-tests/SKILL.md](agent/write-e2e-tests/SKILL.md) |

Do not invent locators, test IDs, or sleeps. Put secrets in `.env`, never in `convoy.config.json` or test files.
