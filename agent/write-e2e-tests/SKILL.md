---
name: write-e2e-tests
description: Turns natural-language app flows into Convoy e2e tests (`*.e2e.yaml` or `*.e2e.ts`). Use when the user describes a user journey, asks to write/add/convert/generate tests, mentions YAML or TypeScript e2e, or phrases steps like tap/type/see.
---

# Write Convoy e2e tests

Convert a human flow into Convoy steps. Phrase intents against what a person sees on screen, never selectors, IDs, XPath, or CSS.

Read this skill before writing or editing `*.e2e.yaml`, `*.e2e.yml`, or `*.e2e.ts`. For install/run/debug, read [../use-convoy/SKILL.md](../use-convoy/SKILL.md). For extra conversions, see [examples.md](examples.md).

## Choose YAML or TypeScript

Default to **YAML**. Same runtime either way.

| Use | When |
|---|---|
| `*.e2e.yaml` | Linear flows, branches (`which`), tags, platforms |
| `*.e2e.ts` | Loops, custom retries, `t.platform({…})`, `t.score`, extra setup after launch |

File name **must** end in `.e2e.yaml`, `.e2e.yml`, or `.e2e.ts`. A plain `.yaml` / `.ts` is ignored. Nested folders are fine.

## Workflow

1. Restate the flow as ordered human actions (tap / type / see). Drop implementation detail.
2. Prefer YAML. Use TypeScript only if the flow needs logic YAML cannot express.
3. Write the goal a person means (`continue`, `log in`, `the email field`). Copy an `inspect` label only when two controls could fit.
4. Put secrets in `.env`. YAML: `type: ${NAME}`. TypeScript: `process.env.NAME` (throw if unset). Never hardcode passwords.
5. Write the file. Do not add `e2e.beforeEach(() => t.resetApp())` — Convoy already resets between tests.
6. One flow = one test. Ordered screens in TypeScript use `e2e.serial`, not a new `e2e()` per screen.

## Natural language → steps

| User says | YAML | TypeScript |
|---|---|---|
| tap / click / press X | `- tap: X` | `await t.tap("X")` |
| type / enter / fill VALUE into FIELD | `- type: ${VALUE}` + `into: FIELD` | `await t.type(secret("VALUE"), { into: "FIELD" })` |
| should see / lands on / shows X | `- see: X` | `await t.see("X")` |
| should not see / no error | `- see.not: X` | `await t.see.not("X")` |
| go back | `- back: true` | `await t.back()` |
| if screen A then … else if B | `- which:` with ≥2 intents | `const screen = await t.which(["A", "B"])` |

`type` without `into` is invalid. `which` needs **at least two** intents. An empty branch is `[]` (YAML) or skip extra steps (TS).

Do **not** invent waits, sleeps, locators, `getByRole`, `testId`, or `waitForSelector`. `tap` / `type` / `see` already retry until the next screen settles (default 20s).

## Phrase intents

- Write the action, not a selector. `"continue"` is enough when that is the unique forward button, even if the label is **Log in** or **Next**.
- If a control with that name is on screen, that control wins (`tap: continue` → **Continue**, not **Log in**). Name **log in** when that is the button you want.
- `inspect` is for disambiguation, not a required vocabulary. Bad: `"button[0]"`, `"#login"`, `"com.example:id/continue"`, `"the blue button in the nav"`.
- If the gate returns **ambiguous**, tighten the phrase to the inspect label. If **not found**, the control is missing, unlabelled, or still loading — do not add a wait.
- `type` is not ambiguous when a heading and the field share a name (`Username` label + `Username` field). Convoy types into the field. Two fields with that name still fail.
- `see` checks for a control, not a screen vibe. An exact visible name wins; otherwise Jev picks among elements or **none**. `see: Log in` fails if that label is absent, even on a login form. Use `which` when the question is which page you are on.

## YAML shape

Required: `name`, non-empty `steps`. Optional: `platforms` (`ios` \| `android` \| `web`), `tags`, `fixture`.

Unknown top-level keys fail parse. One action per step.

```yaml
name: driver signs in
platforms: [ios]
tags: [smoke]
steps:
  - type: ${USERNAME}
    into: Email / Username
  - tap: Continue
  - type: ${PASSWORD}
    into: Password
  - tap: Log in
  - which:
      logged in on another device:
        - tap: Continue Anyway
      the home screen: []
  - see: the home screen
  - see.not: an error message
```

Canonical example: `examples/auth/signin.e2e.yaml`.

## TypeScript shape

```ts
import { e2e } from "convoy-e2e";

e2e.serial("driver signs in", { platforms: ["ios"], tags: ["smoke"] }, (step) => {
  step("enters credentials", async (t) => {
    await t.type(secret("USERNAME"), { into: "Email / Username" });
    await t.tap("Continue");
  });
  step("submits and goes home", async (t) => {
    await t.type(secret("PASSWORD"), { into: "Password" });
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

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env (gitignored).`);
  return value;
}
```

TS-only: `t.platform({ ios, android, web })`, `t.score(intent, { min })`, `t.resetApp()` after extra setup. Canonical example: `examples/auth/signin.e2e.ts`.

## Output rules

- Write the test file. Do not dump the YAML/TS only in chat unless the user asked for a snippet.
- If `.env` needs a new name (`USERNAME`, `API_TOKEN`, …), say so. Do not invent a value.
- If inspect labels are unknown, write the goal the user named (`continue`, `the email field`). Rephrase from `convoy inspect` only if the run is **ambiguous**.
- Do not add unit tests under `tests/unit/` for product flows. Those test Convoy itself.
