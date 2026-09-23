---
name: use-convoy
description: Helps developers install, configure, run, inspect, and debug Convoy semantic e2e tests (CLI `convoy`, package `convoy-e2e`) on iOS, Android, web, or fixture. Use when setting up Convoy, running doctor/init/run/inspect/capture, editing convoy.config.json or .env, or diagnosing ambiguous/not-found/timeout failures.
---

# Use Convoy

Convoy is semantic end-to-end agent testing for iOS, Android, and web. Authors describe what a human sees. Convoy dumps the accessibility tree, normalizes it, asks Jev which control matches, gates the score, then taps / types / asserts.

No selectors. No element IDs. No explicit waits.

Read this skill before answering setup, CLI, config, platform, or failure questions. To write tests from a flow, read [../write-e2e-tests/SKILL.md](../write-e2e-tests/SKILL.md). Full reference: [../../README.md](../../README.md).

## Which tree

| Context | CLI |
|---|---|
| App repo that depends on `convoy-e2e` | `npx convoy <command>` |
| This Convoy repo (hacking the runner) | `npm run convoy -- <command>` after `npm install` |

Node 20+. Package name: `convoy-e2e`. Binary: `convoy`.

## First run (consumer app)

```bash
npm install -D convoy-e2e
npx convoy init --platform ios --yes    # fixture | ios | android | web
# fill .env (TYPESAFE_API_KEY + app secrets). init never overwrites an existing .env
npx convoy doctor
npx convoy run
```

`--yes` skips the platform prompt. Invalid platform exits `1` and writes nothing. `--yes` may overwrite `convoy.config.json`; it **never** overwrites `.env`.

Init writes `convoy.config.json` (commit), `.env` (gitignore), and `tests/sample.e2e.ts` only if no `*.e2e.ts` / `*.e2e.yaml` exist yet.

Copy this folder into the app repo so other agents keep the same guidance:

- `agent/use-convoy/`
- `agent/write-e2e-tests/`

## Config vs secrets

Two files. Do not mix.

| File | Git | Holds |
|---|---|---|
| `convoy.config.json` | commit | platform, bundle IDs, lifecycle, `ready.see`, traces dir, build command |
| `.env` | **ignore** | `TYPESAFE_API_KEY`, UDID, binary paths, test user/password, any app secret |

YAML interpolates `${NAME}`. TypeScript reads `process.env.NAME`. Never put UDIDs, DerivedData paths, or credentials in `convoy.config.json`. Do not put a test-suite path in config — tests are files; `convoy run` finds `*.e2e.ts` / `*.e2e.yaml`.

Do not set `ready.see` on `fixture` unless the fixture actually shows that copy. `see` matches a control (exact name, then Jev among elements + none), not “this looks like that screen.”

### `.env` names agents should know

| Variable | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Live Jev. Empty → heuristic (offline stand-in, not Jev). `convoy run` on ios/android/web warns; fixture does not. |
| `TYPESAFE_BASE_URL` | Default US `https://api.typesafe.ai/v1`; set EU if needed |
| `CONVOY_PLATFORM` | `fixture` \| `ios` \| `android` \| `web` |
| `CONVOY_IOS_UDID` / `CONVOY_IOS_BUNDLE_ID` / `CONVOY_IOS_APP` | Simulator + `.app` path |
| `CONVOY_ANDROID_SERIAL` / `CONVOY_ANDROID_PACKAGE` / `CONVOY_ANDROID_APK` | Device + APK |
| `CONVOY_WEB_BASE_URL` / `CONVOY_WEB_SERVER` | Playwright start URL / optional server command |
| `CONVOY_ACTION_TIMEOUT_MS` | tap/type/see wait (default `20000`) |
| `CONVOY_START` | `launch` \| `attach` — locks the whole run (same as `--restart` / `--reuse`) |
| `CONVOY_TRACE_SCREENSHOTS` | `failure` (default: fail + last step) \| `all` |
| `CONVOY_DEBUG_JEV` | `1` to print Jev Q&A (values redacted) |

Jev stays host-side. The API key never goes into the app binary.

## CLI

```bash
npx convoy init --platform <fixture|ios|android|web> --yes
npx convoy doctor
npx convoy inspect                          # labelled element table for the current screen
npx convoy capture --name login-screen      # fixture + png under .convoy/captures/
npx convoy run                              # all *.e2e.ts and *.e2e.yaml in the project
npx convoy run tests/smoke                  # folder
npx convoy run path/to/flow.e2e.yaml        # one file (YAML + TS in one invocation can both hit the device)
```

`run` flags: `--platform`, `--tag`, `--headed`, `--headless`, `--shard 1/4`, `--step`, `--slow-mo <ms>`, `--junit`, `--reuse`, `--restart`.

`--reuse` attaches to the current screen for the whole run (no install, launch, or reset). `--restart` forces launch for the whole run. Do not pass both (exits `1`). CLI start beats file `start:` and config `sessionStart`.

Skipped dirs: `node_modules`, `dist`, `.convoy`, `.git`. Passing a folder with no e2e files exits `1`.

`inspect` / `capture` / `run` all boot / install / launch first (`prepareEnvironment`). `--reuse` skips install/launch. Or set `CONVOY_LIFECYCLE_INSTALL=0 CONVOY_LIFECYCLE_LAUNCH=0` if the app is already running.

## Platforms (what must already exist)

| Platform | Needs |
|---|---|
| `fixture` | Recorded screen JSON. No device, no API key. This repo uses `tests/fixtures/signin.json` |
| `ios` | Mac, Xcode, iPhone simulator, simulator `.app` (not device `.ipa`), Facebook `idb`. Companion is warmed once; dumps/taps reuse a live gRPC client (CLI fallback) |
| `android` | `adb`, **already running** emulator/device, APK if Convoy should install |
| `web` | `playwright` + Chromium, `CONVOY_WEB_BASE_URL` |

Convoy will boot the iOS simulator, install, and launch. It will **not** start an Android AVD.

## Authoring loop

1. Get the app to the screen (or `run` until it fails there).
2. `convoy inspect` — use labels when two controls could fit; otherwise the action (`continue`, `log in`) is enough.
3. `convoy capture --name …` for offline fixtures.
4. Re-run. Tests must pass alone and in any order (default reset: `relaunch`).

## Failures

| Gate | Meaning | Fix |
|---|---|---|
| **ambiguous** | Two+ controls match the phrase | Rephrase using `inspect` labels. For `type`, a heading+field that share a name is resolved to the field automatically. |
| **not found** | Control missing or dump dropped it | Product bug, or phrase does not match `on screen` |
| **timeout** | Waited `CONVOY_ACTION_TIMEOUT_MS` | App never reached the screen, or raise the timeout |

Traces: `.convoy/runs/<timestamp>/` (`summary.json`, per-step elements + Jev request/response + screenshot). Gitignored.

Do not "fix" a failure by adding a sleep or a locator. Rephrase or fix the app.

## This repo (Convoy itself)

```bash
npm install
npm test                          # unit tests only — no xcrun/idb/adb/live Jev
npm run typecheck
npm run convoy -- doctor
npm run convoy -- run examples/auth/signin.e2e.yaml
```

New runner behavior needs a fast unit test in `tests/unit/` in the same change. Do not hit real devices in `npm test`.
