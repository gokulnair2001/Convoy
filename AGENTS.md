# Agent instructions

Convoy is semantic end-to-end agent testing for iOS, Android, and web (`convoy-e2e`, CLI `convoy`). Authors describe what a human sees — no selectors, IDs, or explicit waits.

Before answering, read the matching skill:

| Topic | Skill |
|---|---|
| Install, configure, run, inspect, debug | [agent/use-convoy/SKILL.md](agent/use-convoy/SKILL.md) |
| Natural-language flow → YAML or TypeScript test | [agent/write-e2e-tests/SKILL.md](agent/write-e2e-tests/SKILL.md) |

Journeys default to `launch` (reset + optional `ready.see`). Use file `start: attach` or `convoy run --reuse` to stay on the current screen. Traces screenshot on failure (and the last passing step) unless `CONVOY_TRACE_SCREENSHOTS=all`.

Do not invent locators, test IDs, or sleeps — tap/type/see already retry, and unchanged screens skip extra matching work. Put secrets in `.env`, never in `convoy.config.json` or test files.
