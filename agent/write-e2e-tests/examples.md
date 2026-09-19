# Natural language → Convoy tests

## Smoke login (YAML)

**User:** Driver opens the app, types email and password, taps Log in, and should land on home. Sometimes a "logged in on another device" sheet appears.

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
```

## Settings toggle (YAML)

**User:** From home, open Settings, turn on dark mode, confirm it is on, go back.

```yaml
name: enable dark mode
tags: [settings]
steps:
  - tap: Settings
  - tap: Dark mode
  - see: Dark mode on
  - back: true
  - see: the home screen
```

## Search that needs a loop (TypeScript)

**User:** Type each fleet id from `FLEET_IDS` (comma-separated in `.env`) into search and confirm the result row.

YAML cannot loop. Use TypeScript:

```ts
import { e2e } from "convoy-e2e";

e2e("search each fleet id", { tags: ["regression"] }, async (t) => {
  const ids = (process.env.FLEET_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("Set FLEET_IDS in .env (comma-separated).");
  for (const id of ids) {
    await t.type(id, { into: "Search" });
    await t.see(id);
  }
});
```

## Platform-specific extra tap (TypeScript)

**User:** Same checkout flow; on iOS also tap Face ID later.

```ts
import { e2e } from "convoy-e2e";

e2e("checkout", { platforms: ["ios", "android"] }, async (t) => {
  await t.tap("Checkout");
  await t.platform({
    ios: async () => {
      await t.tap("Continue with Face ID");
    },
  });
  await t.see("order confirmed");
});
```

## What not to emit

```ts
// BAD — locators, waits, per-screen reset
await page.getByTestId("login").click();
await t.tap("Continue");
await new Promise((r) => setTimeout(r, 3000));
e2e("screen 2", async (t) => { /* separate e2e() resets the app */ });
```
