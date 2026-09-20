# Convoy

Semantic end-to-end agent testing for iOS, Android, and web.

You describe what should happen in plain language. Convoy dumps the live
accessibility tree, normalizes it to a platform-agnostic element table, asks
[Jev](https://typesafe.ai) which control matches the intent, and taps it.

No selectors. No element IDs. No explicit waits.

```yaml
name: driver signs in
platforms: [ios]
tags: [smoke]
steps:
  - tap: Continue
  - tap: Log in
  - see: the home screen
```

Package: `convoy-e2e` · CLI: `convoy` · Node 20+

Using a coding agent? Give it the skill files first so it can set up Convoy and write tests without inventing locators:

- Setup, `init` / `doctor` / `run` / `inspect`: [agent/use-convoy/SKILL.md](agent/use-convoy/SKILL.md)
- Natural-language flow → `*.e2e.yaml` / `*.e2e.ts`: [agent/write-e2e-tests/SKILL.md](agent/write-e2e-tests/SKILL.md)

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [First run](#first-run)
- [Configuration](#configuration)
- [Platforms](#platforms)
- [Writing tests](#writing-tests)
- [AI agents](#ai-agents)
- [CLI reference](#cli-reference)
- [Lifecycle (boot / build / install / launch)](#lifecycle-boot--build--install--launch)
- [Jev](#jev)
- [Failures and gates](#failures-and-gates)
- [Traces](#traces)
- [CI](#ci)
- [Troubleshooting](#troubleshooting)
- [Download packages](#download-packages)
- [Publishing](#publishing)
- [Development](#development)

---

## How it works

```
author intent  →  dump AX tree  →  normalize  →  Jev  →  gate  →  tap / type / see
```

1. The driver snapshots the current screen (`idb ui describe-all`, `uiautomator`, or the DOM).
2. Convoy normalizes that dump into a small table of labelled controls (role, name, bounds). Unlabelled chrome is dropped.
3. Jev scores *presence* (is this control on screen?) and *target* (which control matches the phrase).
4. A gate turns those scores into **pass**, **ambiguous** (rephrase the step), or **not found** (likely a product bug).
5. On pass, Convoy taps or types. `tap` / `type` / `see` retry until the next screen settles (default 20s).

The same test file can target iOS, Android, and web. Phrase steps against what a human sees, not against implementation IDs.

---

## Prerequisites

You only need what the platform you are targeting uses. Convoy boots / installs / launches the **app**; it does not install these tools. `npx convoy doctor` lists anything missing. Install commands: [Download packages](#download-packages).

| | Required |
|---|---|
| **All** | [Node.js 20+](#nodejs) · TypeSafe Jev API key for live matching ([Jev](#jev)) |
| **Fixture** | Nothing else (recorded screen JSON; no device, no key) |
| **iOS** | Xcode · iPhone simulator · simulator `.app` · [Facebook idb](#facebook-idb) |
| **Android** | [adb](#android-sdk-adb) · already-running emulator or device · APK if Convoy should install it |
| **Web** | [Playwright Chromium](#playwright-chromium) if the browser is missing after `npm install` |

---

## Install

Add the published package to **your** test project (or app repo). You do not clone this repo to run tests.

```bash
npm install -D convoy-e2e
```

That registers the `convoy` CLI. Call it with `npx`:

```bash
npx convoy init --platform ios --yes
npx convoy doctor
npx convoy run
```

npm scripts can use the `convoy` binary directly (`node_modules/.bin` is on PATH there), then `npm run e2e`:

```json
{
  "scripts": {
    "e2e": "convoy run"
  }
}
```

`init` writes `convoy.config.json`, `.env`, and a sample test in **that** project. Do not put secrets in `convoy.config.json`. TypeScript tests import `{ e2e } from "convoy-e2e"`. The package name is `convoy-e2e`; the CLI binary is `convoy`.

### This repo (contributors)

```bash
git clone <this-repo>
cd Convoy
npm install
```

While hacking on Convoy itself, `npm run convoy -- …` runs TypeScript from `src/`. After `npm run build`, `npx convoy` uses `dist/`.

---

## First run

### 1. Scaffold

```bash
npx convoy init --platform fixture --yes
```

`--platform fixture` is offline (recorded screen, no device, no API key). For a real app use `ios`, `android`, or `web`. `--yes` skips the platform prompt. Invalid platform exits `1` and writes nothing.

That writes (and will not smash an existing `.env`):

| File | Git | What |
|---|---|---|
| `convoy.config.json` | commit | Platform, bundle IDs, lifecycle, traces |
| `.env` | **ignore** | API key, test user/password, UDID, binary paths |
| `tests/sample.e2e.ts` | commit if useful | Only if no `*.e2e.ts` / `*.e2e.yaml` exist yet |

`--platform` may be `fixture`, `ios`, `android`, or `web`. `--yes` skips the one platform prompt. Invalid platform exits `1` and writes nothing.

### 2. Fill `.env`

Convoy’s own key:

```bash
TYPESAFE_API_KEY=           # from console.typesafe.ai
```

Anything else your **application** needs (tokens, credentials, private keys) also goes in `.env`. Name the variables however you like. Never commit real values.

YAML interpolates them as `${NAME}`. TypeScript reads `process.env.NAME`.

### 3. Check the machine

```bash
npx convoy doctor
```

Required checks (Node, package, config) should pass. Missing `idb` / `adb` / Playwright / API key are **warnings**. Doctor also prints a resolved block (platform, bundle, UDID, binary path, Jev mode) with the API key shown only as `set` / `not set`.

### 4. Run

```bash
npx convoy inspect                    # element table for the current screen
npx convoy run                        # every *.e2e.ts / *.e2e.yaml in the project
```

This repo also ships **two** sign-in examples (YAML and TypeScript) with the same flow. Pass **one** file so both do not hit the device:

```bash
npx convoy run examples/auth/signin.e2e.yaml
# or
npx convoy run examples/auth/signin.e2e.ts
```

---

## Configuration

Two files. Do not mix secrets into the committed config.

### `convoy.config.json` (committed)

Project defaults. Example for iOS:

```json
{
  "platform": "ios",
  "app": {
    "bundleId": "com.example.app",
    "package": "com.example.app",
    "displayName": "Example App"
  },
  "ios": {
    "bundleId": "com.example.app",
    "simulator": { "boot": true, "open": true },
    "build": {
      "command": "xcodebuild -scheme ExampleApp -configuration Preview-Debug -destination 'id=${CONVOY_IOS_UDID}'",
      "when": "missing"
    }
  },
  "reset": "relaunch",
  "lifecycle": {
    "install": true,
    "launch": true,
    "resetBetweenTests": true
  },
  "ready": { "see": "the login screen", "timeoutMs": 30000 },
  "tracesDir": ".convoy/runs"
}
```

`build.when`: `missing` (default — run only if the `.app` / APK is not on disk), `always`, or `never`. `${CONVOY_IOS_UDID}` and other `CONVOY_*` / `TYPESAFE_*` names expand from the environment.

Do **not** put a UDID or DerivedData path in this file. Those belong in `.env` (they change per machine).

Do **not** put a test-suite path here. Config is app / platform / lifecycle. Tests are `*.e2e.ts` and `*.e2e.yaml` files; `convoy run` finds them, or you pass a file or folder.

Do **not** set `ready.see` while `platform` is `fixture` unless the fixture actually contains that copy. The bundled sign-in fixture lands on **Sign in**.

### `.env` (gitignored)

Copy from `.env.example`. Environment variables override the JSON file.

**Convoy / machine:** `TYPESAFE_API_KEY`, platform, UDID, binary paths.

**Your application:** any private keys the tests must type or assert. Put them in the same file under names you choose. YAML uses `${NAME}`; TypeScript uses `process.env.NAME`. Convoy does not ship a fixed list of app credential variables.

| Variable | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Jev key. Empty → heuristic mode |
| `TYPESAFE_BASE_URL` | Default US `https://api.typesafe.ai/v1`. Point at EU if needed |
| `TYPESAFE_MODEL` | Default `jev-latest` |
| `CONVOY_PLATFORM` | `fixture` \| `ios` \| `android` \| `web` |
| `CONVOY_IOS_UDID` | Simulator UDID (`xcrun simctl list devices available`) |
| `CONVOY_IOS_BUNDLE_ID` | App bundle ID |
| `CONVOY_IOS_APP` | Absolute path to the `.app` |
| `CONVOY_IOS_BUILD` | Optional `xcodebuild` command |
| `CONVOY_SIMULATOR_BOOT` | `0` to skip booting |
| `CONVOY_ANDROID_SERIAL` | `adb -s` serial |
| `CONVOY_ANDROID_PACKAGE` | Application ID |
| `CONVOY_ANDROID_APK` | Absolute path to the APK |
| `CONVOY_WEB_BASE_URL` | Playwright start URL |
| `CONVOY_WEB_SERVER` | Optional command to start the web app |
| `CONVOY_ACTION_TIMEOUT_MS` | How long tap/type/see wait for the next screen (default `20000`) |
| `CONVOY_RESET` | `relaunch` \| `clear` \| `reinstall` |
| `CONVOY_JEV_MODE` | `heuristic` \| `recorded` \| `live` |
| `CONVOY_DEBUG_JEV` | `1` to print each Jev question and answer |

Any other `NAME=value` pair in `.env` is yours. Convoy does not prescribe application credential names. YAML `${NAME}` and `process.env.NAME` both read them.

`init` will fill `CONVOY_IOS_UDID` in a **new** `.env` if a simulator is already booted. It never overwrites an existing `.env`.

---

## Platforms

### Fixture (offline)

No device, no API key. Uses `tests/fixtures/signin.json` (or `fixture.path` in config). Good for unit tests and CI of Convoy itself.

```bash
CONVOY_PLATFORM=fixture npx convoy inspect
CONVOY_PLATFORM=fixture npx convoy run examples/auth/signin.e2e.ts
```

Without `TYPESAFE_API_KEY`, Jev is the local heuristic client.

### iOS simulator

```bash
xcrun simctl list devices available          # pick a UDID
# build the app in Xcode once, or set ios.build.command
```

`.env`:

```bash
CONVOY_PLATFORM=ios
CONVOY_IOS_UDID=1A119540-C830-42DE-B1B5-67F3AE34F6AA
CONVOY_IOS_BUNDLE_ID=com.example.app
CONVOY_IOS_APP=/path/to/ExampleApp.app
TYPESAFE_API_KEY=…
# plus any application secrets your tests type or assert
```

Then:

```bash
npx convoy doctor
npx convoy run examples/auth/signin.e2e.yaml --headed
```

On `run`, Convoy will:

1. Boot the simulator if it is shut down (`simulator.boot`, default on)
2. Open Simulator.app when headed (`simulator.open`)
3. Run `build.command` if configured and the binary is missing
4. `idb install` (or `simctl install`) when `CONVOY_IOS_APP` is set
5. Launch the bundle
6. Reset the app before each test (`relaunch` by default)

You should not need to launch the app in Xcode first.

Find the `.app` under Xcode DerivedData, for example:

`~/Library/Developer/Xcode/DerivedData/<Project>-…/Build/Products/<Config>-iphonesimulator/<App>.app`

### Android

Start an emulator (or plug in a device), then:

```bash
CONVOY_PLATFORM=android
CONVOY_ANDROID_SERIAL=emulator-5554          # optional if only one device
CONVOY_ANDROID_PACKAGE=com.example.app
CONVOY_ANDROID_APK=/path/to/app.apk
```

Convoy runs `adb start-server`, `adb install -r` when an APK is set, then launches via monkey. It will **not** guess an AVD name; the emulator must already be running. `reinstall` reset requires `android.apkPath` / `CONVOY_ANDROID_APK`.

### Web

```bash
CONVOY_PLATFORM=web
CONVOY_WEB_BASE_URL=http://localhost:3000
# optional: CONVOY_WEB_SERVER="npm run start"
```

Playwright Chromium (installed with `convoy-e2e`). If `web.server.command` (or `CONVOY_WEB_SERVER`) is set, Convoy spawns it and waits until the URL responds. If Chromium is missing, see [Playwright Chromium](#playwright-chromium).

---

## Writing tests

Prefer **YAML** (`*.e2e.yaml` / `*.e2e.yml`) for flows. Use **TypeScript** (`*.e2e.ts`) when you need loops, custom retries, or logic YAML should not grow.

Put them anywhere in the project. Nested folders are fine. A plain `.ts` / `.yml` is ignored — the name must end in `.e2e.ts`, `.e2e.yaml`, or `.e2e.yml`.

```
tests/
  smoke/
    login.e2e.yaml
  regression/
    checkout.e2e.yaml
    settings/
      profile.e2e.ts
```

`convoy run` with no args walks the whole project (skipping `node_modules`, `dist`, `.convoy`, `.git`). `convoy run tests/regression` runs only the e2e files under that folder, TypeScript and YAML together.

Both compile to the same `Steps` runtime. Each test gets one app session and an implicit reset. Do not add `e2e.beforeEach(() => t.resetApp())` unless you need extra setup after launch.

### YAML

```yaml
name: driver signs in          # required
platforms: [ios]               # optional; omit = all
tags: [smoke]                  # optional; --tag smoke filters on this
fixture: tests/fixtures/signin.json   # optional; fixture driver only
steps:                         # required, non-empty
  - type: ${API_TOKEN}         # any key from .env; expands at run time
    into: the search field     # phrase this as inspect shows it
  - tap: Continue
  - see: the home screen
  - see.not: an error message
  - back: true
  - which:
      logged in on another device:
        - tap: Continue Anyway
      the home screen: []      # empty = no extra steps on that branch
```

| Step | Meaning |
|---|---|
| `tap: <intent>` | Resolve the control and tap it |
| `type: <text>` + `into: <intent>` | Resolve the field and type. `${ENV}` on `type` must be set or the step fails |
| `see: <intent>` | Assert the screen / copy is present |
| `see.not` / `seeNot` / `see_not` / `not: { see: … }` | Assert it is absent |
| `back: true` | Platform back |
| `which: { intent: [steps], … }` | Wait until one of ≥2 screens is present, then run that branch |

Phrase intents like a human: `"continue"`, `"the home screen"`. A unique on-screen name still wins; if that name is missing, tap may resolve the unique forward CTA (continue / next / log in). If Jev returns **ambiguous**, disambiguate the phrase (`inspect` shows the labels it can see).

`${NAME}` on `type` is expanded when the step runs. Listing or parsing tests does not require those secrets to be set. If a token is still unset at run time, Convoy tells you to add it to `.env`.

### TypeScript

```ts
import { e2e } from "convoy-e2e";

e2e("driver signs in", { platforms: ["ios"], tags: ["smoke"] }, async (t) => {
  await t.type(process.env.API_TOKEN!, { into: "the search field" });
  await t.tap("Continue");
  await t.see("the home screen");
  await t.see.not("an error message");
});
```

Ordered screens in one session (first field → Continue → next screen) use `e2e.serial` so the app is **not** reset between those steps:

```ts
e2e.serial("driver signs in", { platforms: ["ios"], tags: ["smoke"] }, (step) => {
  step("continues", async (t) => {
    await t.type(process.env.API_TOKEN!, { into: "the search field" });
    await t.tap("Continue");
  });
  step("lands home", async (t) => {
    await t.tap("Log in");
    const screen = await t.which([
      "logged in on another device",
      "the home screen",
    ]);
    if (screen === "logged in on another device") {
      await t.tap("Continue Anyway");
    }
    await t.see("the home screen");
  });
});
```

| Call | Meaning |
|---|---|
| `t.tap(intent)` | Tap |
| `t.type(text, { into })` | Type into a field |
| `t.see(intent)` / `t.see.not(intent)` | Assert presence / absence |
| `t.which([a, b])` | Wait until one screen matches; returns that intent |
| `t.back()` | Platform back |
| `t.score(intent, { min })` | Numeric oracle |
| `t.platform({ ios, android, web })` | Branch by platform |
| `t.resetApp()` | Extra reset (already done before each test) |

Do not write a separate `e2e()` per screen of one flow — each `e2e()` resets the app.

### Authoring loop

1. Get the app to the screen you care about (or `convoy run` until it fails there).
2. `npx convoy inspect` — use labels when two controls could fit; the action (`continue`) is enough when it is unique.
3. `npx convoy capture --name login-screen` — save a fixture + screenshot under `.convoy/captures/` for later offline work.
4. Re-run. If the gate says **ambiguous**, the phrase matches two controls; tighten it. If **not found**, the control is missing or the dump dropped it.

Tests must pass alone and in any order. Default reset between tests is `relaunch`.

---

## AI agents

This repo ships skills any coding agent can load:

| Skill | Path |
|---|---|
| Install, configure, run, inspect, debug | `agent/use-convoy/SKILL.md` |
| Natural-language flow → `*.e2e.yaml` / `*.e2e.ts` | `agent/write-e2e-tests/SKILL.md` |

Root `AGENTS.md` points at those files. After `npm install -D convoy-e2e`, copy `agent/` into the app repo (or keep `node_modules/convoy-e2e/agent/` on the agent's include path).

---

## CLI reference

Use `npx convoy <command>` after `npm install -D convoy-e2e`. Contributors hacking this repo can use `npm run convoy -- <command>` instead.

### `init`

```bash
npx convoy init --platform ios --yes
```

| Flag | Meaning |
|---|---|
| `--platform fixture\|ios\|android\|web` | Non-interactive platform |
| `--yes` | Overwrite `convoy.config.json` if it exists. **Never** overwrites `.env` |

Without flags, asks one question (platform) when stdin is a TTY; otherwise defaults to `fixture`.

### `run`

```bash
npx convoy run [files…] [options]
```

| You pass | What runs |
|---|---|
| nothing | every `*.e2e.ts` and `*.e2e.yaml` / `*.e2e.yml` under the project |
| a **folder** | nested `*.e2e.ts` and `*.e2e.yaml` under that folder only |
| `path/to/file.e2e.yaml` | that YAML file only |
| `path/to/file.e2e.ts` | that TypeScript file only (YAML is skipped) |

`node_modules`, `dist`, `.convoy`, and `.git` are skipped. An empty folder exits `1` instead of running the rest of the project.

```bash
npx convoy run tests/regression
npx convoy run examples/auth/signin.e2e.yaml
```

| Flag | Meaning |
|---|---|
| `--platform <name>` | Override config / `.env` for this run. Applied **before** boot/install |
| `--tag <tag>` | Only tests that list this tag |
| `--headed` | Watch it happen; one worker |
| `--headless` | Quiet actions; iOS/Android still one worker |
| `--shard 1/4` | CI shard |
| `--step` | Pause before each action |
| `--slow-mo <ms>` | Delay after each action |
| `--junit` | Write `reports/junit.xml` |

A headed run looks like:

```
Convoy  0.1.0
  platform   ios · iPhone (UDID)
  app        Example App  com.example.app
  jev        live · jev-latest
  traces     .convoy/runs/…

↻  booting simulator…
✓  simulator ready  1.2s
↻  installing app…
✓  launched  3.2s

driver signs in
  ▶  tap   "Continue" → Continue     0.99  380ms
  ▶  tap   "Log in"   → Log in       0.98  1.2s
✓  driver signs in  (18.4s)

1 passed  0 failed  22s
   traces  .convoy/runs/…
```

Jev Q&A is off unless `CONVOY_DEBUG_JEV=1`.

### `inspect`

Print the labelled element table for the current screen (after the same boot/install/launch as `run`). Use this to phrase steps.

### `capture`

```bash
npx convoy capture --name login-screen --out .convoy/captures
```

Writes `<name>.json` (normalized elements + raw dump) and `<name>.png`.

### `doctor`

Checks Node, config, fixture file, API key, `idb`, `adb`, Playwright. Then prints resolved platform / bundle / UDID / binary / Jev mode.

Exit `0` if every **required** check passed.

---

## Lifecycle (boot / build / install / launch)

`convoy run`, `inspect`, and `capture` call `prepareEnvironment` once per invocation. The Vitest worker does not prepare a second time (`CONVOY_PREPARED=1`).

| Step | iOS | Android | Web |
|---|---|---|---|
| Boot | `simctl boot` (already-booted is OK) | `adb start-server`; warns if no device | — |
| Build | `ios.build.command` when `when` says so | `android.build.command` | — |
| Install | `idb install` / `simctl install` if `appPath` exists | `adb install -r` if `apkPath` exists | — |
| Launch | `idb launch` / `simctl launch` | monkey LAUNCHER | goto `baseUrl`; optional `web.server` |
| Per test | `reset` (`relaunch` / `clear` / `reinstall`) | same | goto + optional storage clear |
| Ready | optional `ready.see` via `t.see` | same | same |

`clear` on iOS with `appPath` uninstalls and reinstalls (wipes data). `relaunch` only terminate + launch (faster). `reinstall` on Android needs an APK path.

To skip install/launch (app already running):

```bash
CONVOY_LIFECYCLE_INSTALL=0 CONVOY_LIFECYCLE_LAUNCH=0
```

---

## Jev

Convoy talks to Jev as a **host-side** process. The key never goes into an iOS/Android/web binary.

| Mode | When | Needs key? |
|---|---|---|
| `heuristic` | No key, or `CONVOY_JEV_MODE=heuristic` | no |
| `recorded` | Replay saved responses (`CONVOY_JEV_RECORDED_DIR`) | no |
| `live` | Key present (default once `.env` is set) | **yes** |

Heuristic is a deterministic stand-in for unit tests. It is not Jev. Use live mode on a real app.

US default base URL: `https://api.typesafe.ai/v1`. For EU set `TYPESAFE_BASE_URL`.

`CONVOY_DEBUG_JEV=1` prints each System One question and answer (element **values** are omitted so passwords stay out of the terminal).

---

## Failures and gates

A failed step prints what the test asked for, what the screen actually showed, scores, and what to do next:

```
✗  driver signs in
   examples/auth/signin.e2e.yaml

could not tap "Log in"

  waited    20s
  scores    none 0.90  ·  present 0.08
  on screen
    [1] Back
    [3] Email / Username
    [5] Continue

  next      waited 20s and it never appeared — still loading, or the phrase does not match this UI
            convoy inspect
            raise CONVOY_ACTION_TIMEOUT_MS if the app is slow
  traces    .convoy/runs/2026-09-19T16-28-20
```

| Outcome | Meaning | What you do |
|---|---|---|
| pass | Proceed | — |
| **ambiguous** | Two or more controls fit the phrase | Rephrase. `inspect` lists the candidates |
| **not found** | The control is not on this screen (or the dump dropped it) | Product bug, or the phrase does not match — check `on screen` |
| **timeout** | Waited the full action timeout and it never appeared | Raise `CONVOY_ACTION_TIMEOUT_MS`, or the app never reached that screen |

Default thresholds (tune on real screens before CI):

| Gate | Default |
|---|---|
| presence | 0.90 |
| none | 0.10 |
| target | 0.75 |
| gap | 0.20 |
| assertion | 0.85 |

Overrides: `CONVOY_GATE_PRESENCE`, `CONVOY_GATE_NONE`, `CONVOY_GATE_TARGET`, `CONVOY_GATE_GAP`, `CONVOY_GATE_ASSERTION`, or `gates` in `convoy.config.json`.

---

## Traces

Every run writes `.convoy/runs/<timestamp>/`:

| File | Contents |
|---|---|
| `summary.json` | Pass/fail, timing |
| `step-NN/elements.json` | Normalized table Jev saw |
| `step-NN/request.json` | Exact Jev request |
| `step-NN/response.json` | Exact Jev response |
| screenshot | PNG of the screen |

Same layout locally and in CI. The CLI prints the traces path on failure. `.convoy/` is gitignored.

---

## CI

```bash
npx convoy run --headless --junit --shard 1/4
```

- Inject `TYPESAFE_API_KEY` and any application secrets from the secret store. Do not commit `.env`.
- Upload `.convoy/runs/` and `reports/junit.xml` as artifacts.
- iOS/Android stay on one worker even with `--headless` (one simulator).
- Fixture + heuristic can gate Convoy’s own PRs without a device or key: `npm test`.

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| `Set API_TOKEN in .env` | YAML `type: ${API_TOKEN}` with that name unset |
| `doctor` warns `TYPESAFE_API_KEY not set` | Live Jev disabled; fixture still works |
| `idb` / `adb` not found | Install tools in [Download packages](#download-packages); doctor shows warnings, not a hard fail |
| Prepare fails on iOS | Xcode CLT, a simulator exists, `CONVOY_IOS_UDID` matches a **booted or bootable** iPhone |
| App does not appear | `CONVOY_IOS_APP` / `CONVOY_ANDROID_APK` path exists; `lifecycle.install` / `launch` are true |
| Stuck on a spinner | Raise `CONVOY_ACTION_TIMEOUT_MS`; the failure log lists `on screen` labels |
| **two controls match** | Rephrase; `convoy inspect` lists labels |
| **could not tap / did not see** | Control missing, unlabelled, or still loading — read `on screen` and traces |
| YAML test never runs | File must be `*.e2e.yaml`; `convoy run some.e2e.ts` will not load YAML. Pass the yaml path, a folder of tests, or run with no file args |
| Both sign-in examples run | Pass one file: `run examples/auth/signin.e2e.yaml` |
| Jev spam on the terminal | Default is off. Unset `CONVOY_DEBUG_JEV` or set it to `0` |
| `init` did not change `.env` | Existing `.env` is never overwritten. Edit it by hand |
| Wrong simulator | `doctor` resolved UDID; set `CONVOY_IOS_UDID` in `.env`, not in committed JSON |

---

## Download packages

Install commands for the tools listed in [Prerequisites](#prerequisites). Skip anything you already have. `npx convoy doctor` prints what is missing.

### Node.js

Need v20 or newer (`node -v`). npm ships with it.

```bash
# macOS (Homebrew)
brew install node

# any OS (nvm) — https://github.com/nvm-sh/nvm
nvm install 20
```

Or the LTS installer from [nodejs.org](https://nodejs.org).

### Facebook idb

iOS only. Companion + CLI.

```bash
brew tap facebook/fb
brew install idb-companion
pip3 install fb-idb
idb --help
```

Also need **Xcode** (Mac App Store) and command-line tools:

```bash
xcode-select --install
xcrun simctl list devices available
```

The app binary must be a **simulator** `.app`, not a device `.ipa`.

### Android SDK (adb)

```bash
# macOS (Homebrew)
brew install --cask android-platform-tools

adb start-server
adb devices
```

Or install [Android Studio](https://developer.android.com/studio) / SDK `platform-tools` and put `adb` on `PATH`. Start an emulator (or plug in a device) yourself — Convoy will not create or boot an AVD.

### Playwright Chromium

The Playwright npm package ships as an optional dependency of `convoy-e2e`. If Chromium is missing after `npm install`:

```bash
npx playwright install chromium
```

---

## Publishing

Day-to-day work stays on `develop`. Merging to `main` is a release: GitHub Actions bumps the patch version, tags the repo, creates a GitHub Release, and publishes `convoy-e2e` to npm. For a minor or major bump, run the **Release** workflow by hand and pick the increment.

No npm token is stored in GitHub. Publishes from Actions use [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC).

### 1. First publish (once, from your machine)

The package must exist on npm before you can attach a trusted publisher.

```bash
npm login
npm whoami
npm test
npm publish --access public
```

That ships the current `package.json` version (`0.1.0` until the first Action run bumps it). Confirm: [npmjs.com/package/convoy-e2e](https://www.npmjs.com/package/convoy-e2e).

### 2. Trust this repo on npm

On [npmjs.com](https://www.npmjs.com) → **convoy-e2e** → **Settings** → **Trusted Publisher**:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `gokulnair2001` |
| Repository | `Convoy` |
| Workflow filename | `release.yml` |
| Environment | leave empty |
| Allowed actions | `npm publish` |

The filename must be exactly `release.yml` (not the `.github/workflows/` path).

### 3. After that

Merge a PR into `main` (or merge `develop` → `main`). The [Release](.github/workflows/release.yml) workflow:

1. Runs unit tests and typecheck
2. `npm version patch` (or the increment you chose on a manual run)
3. Pushes `vX.Y.Z` and a `chore: release` commit
4. `npm publish`
5. Opens a GitHub Release with generated notes

If `main` requires pull requests, allow GitHub Actions to push (or let `github-actions[bot]` bypass that rule). Otherwise the version commit cannot land.

Do not put an npm token in the repo or in `convoy.config.json`.

---

## Development

```bash
npm install
npm test                 # unit tests (vitest)
npm run typecheck
npm run convoy -- doctor
```

Layout:

| Path | Role |
|---|---|
| `src/cli/` | `init`, `run`, `inspect`, `capture`, `doctor` |
| `src/vitest/` | Consumer e2e Vitest config (published in `dist`) |
| `src/lifecycle/` | Boot / build / install / launch |
| `src/drivers/` | iOS, Android, web, fixture |
| `src/core/` | Normalize, gates, config |
| `src/jev/` | Resolver, oracle, clients |
| `src/runner/` | `e2e`, session, steps, reporter |
| `src/yaml/` | YAML → `Steps` |
| `examples/auth/` | Sign-in (YAML + TypeScript) |
| `agent/` | Skills for coding agents (use Convoy + write tests) |
| `tests/unit/` | Offline unit tests |
| `tests/fixtures/` | Recorded screens |

New behavior needs unit tests in the same change. Keep tests fast: no real `xcrun` / `idb` / `adb` / Jev in `npm test`.

### Status

| Milestone | What | Device? |
|---|---|---|
| M0 | Package, `Driver`, `FixtureDriver` | no |
| M1 | Normalizer (iOS / Android / web) | no |
| M2 | Jev client — resolver + oracle | no |
| M3 | Gate + traces | no |
| M4 | CLI: `init`, `run`, `inspect`, `capture`, `doctor` | no |
| M5 | iOS via `idb` | yes |
| M6 | Threshold calibration on real screens | yes |
| M7 | Android driver | yes |
| M8 | Web driver | no |
| M9 | CI: headless, shards, JUnit, traces | — |

M0–M4 run fully offline. Device drivers are implemented; they need a simulator, emulator, or browser.

### Next

- Capture 3–5 real `idb ui describe-all` dumps from your app and
  re-validate the normalizer.
- Run live Jev against those screens and compare heuristic vs recorded.
- Set `CONVOY_PLATFORM=ios` + `CONVOY_IOS_APP` and run `examples/auth/signin.e2e.yaml`.
