import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/load-config.js";
import { createSession } from "../../src/runner/session.js";
import { AmbiguousError, NotFoundError } from "../../src/core/errors.js";
import type { Driver } from "../../src/core/driver.js";
import { FixtureDriver } from "../../src/drivers/fixture.js";
import type { JevClient, JevRequest, JevResponse } from "../../src/jev/types.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function sessionFor(fixture: string, testName: string) {
  const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
  dirs.push(tracesDir);
  const config = await loadConfig();
  config.platform = "fixture";
  config.jev.mode = "heuristic";
  config.jev.apiKey = undefined;
  config.fixture.path = fixture;
  config.tracesDir = tracesDir;
  config.slowMoMs = 0;
  config.stepMode = false;
  return createSession(config, testName);
}

describe("signin fixture flow", () => {
  it("runs the authored signin steps against a fixture", async () => {
    const session = await sessionFor("tests/fixtures/signin.json", "driver signs in");
    try {
      const t = session.steps;
      await t.resetApp();
      await t.tap("the sign in button");
      await t.type("test@example.com", { into: "the email field" });
      await t.type("Passw0rd!", { into: "the password field" });
      await t.tap("continue");
      await t.see("the trip list screen");
      await t.see.not("an error message");
    } finally {
      await session.tracer.finish("pass");
      await session.close();
    }
  });

  it("taps Continue when the author says log in and that is the only forward button", async () => {
    const session = await sessionFor("tests/fixtures/signin.json", "driver signs in by intent");
    try {
      const t = session.steps;
      await t.resetApp();
      await t.tap("the sign in button");
      await t.type("test@example.com", { into: "the email field" });
      await t.type("Passw0rd!", { into: "the password field" });
      await t.tap("log in");
      await t.see("the trip list screen");
    } finally {
      await session.tracer.finish("pass");
      await session.close();
    }
  });

  it("see Log in fails on the email form instead of matching Continue", async () => {
    const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
    dirs.push(tracesDir);
    const config = await loadConfig();
    config.platform = "fixture";
    config.jev.mode = "heuristic";
    config.jev.apiKey = undefined;
    config.fixture.path = "tests/fixtures/signin.json";
    config.tracesDir = tracesDir;
    config.actionTimeoutMs = 80;
    const session = await createSession(config, "see log in on email form");
    try {
      const t = session.steps;
      await t.resetApp();
      await t.tap("the sign in button");
      await expect(t.see("Log in")).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await session.tracer.finish("fail");
      await session.close();
    }
  });

  it("surfaces an ambiguous continue as a spec problem", async () => {
    const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
    dirs.push(tracesDir);
    const config = await loadConfig();
    config.platform = "fixture";
    config.jev.mode = "heuristic";
    config.fixture.path = "tests/fixtures/ambiguous-continue.json";
    config.tracesDir = tracesDir;
    const jev: JevClient = {
      async systemOne(_request: JevRequest): Promise<JevResponse> {
        return {
          answers: {
            present: { type: "noul", noul: 0.97 },
            target: {
              type: "choice",
              choice: "e4",
              probabilities: { e4: 0.48, e5: 0.44, none: 0.02 },
            },
          },
        };
      },
    };
    const driver = await FixtureDriver.fromFile("tests/fixtures/ambiguous-continue.json");
    const session = await createSession(config, "ambiguous continue", { driver, jev });
    try {
      await expect(session.steps.tap("continue")).rejects.toBeInstanceOf(AmbiguousError);
    } finally {
      await session.tracer.finish("fail");
      await session.close();
    }
  });

  it("which waits until one of two screens is present", async () => {
    const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
    dirs.push(tracesDir);
    const config = await loadConfig();
    config.platform = "fixture";
    config.jev.mode = "heuristic";
    config.jev.apiKey = undefined;
    config.fixture.path = "tests/fixtures/signin.json";
    config.tracesDir = tracesDir;
    config.actionTimeoutMs = 5_000;
    let calls = 0;
    const jev: JevClient = {
      async systemOne(): Promise<JevResponse> {
        calls += 1;
        if (calls === 1) {
          return {
            answers: {
              screen: {
                type: "choice",
                choice: "none",
                probabilities: { s0: 0.08, s1: 0.1, none: 0.82 },
              },
            },
          };
        }
        return {
          answers: {
            screen: {
              type: "choice",
              choice: "s1",
              probabilities: { s0: 0.06, s1: 0.88, none: 0.06 },
            },
          },
        };
      },
    };
    const inner = await FixtureDriver.fromFile("tests/fixtures/signin.json");
    let snaps = 0;
    const driver: Driver = {
      kind: inner.kind,
      async snapshot() {
        const els = await inner.snapshot();
        snaps += 1;
        if (snaps < 2) return els;
        return [
          ...els,
          { id: "e-home", role: "text", name: "Trips", enabled: true, bounds: [0, 0, 0.3, 0.05], ref: {} },
        ];
      },
      tap: (el) => inner.tap(el),
      type: (el, text) => inner.type(el, text),
      reset: () => inner.reset(),
      screenshot: () => inner.screenshot(),
      back: () => inner.back(),
      close: () => inner.close(),
    };
    const session = await createSession(config, "which", { driver, jev });
    try {
      const screen = await session.steps.which(["a list of existing logins", "the home screen"]);
      expect(screen).toBe("the home screen");
      expect(calls).toBe(2);
    } finally {
      await session.tracer.finish("pass");
      await session.close();
    }
  });

  it("which times out with the last screen names when neither branch appears", async () => {
    const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
    dirs.push(tracesDir);
    const config = await loadConfig();
    config.platform = "fixture";
    config.jev.mode = "heuristic";
    config.jev.apiKey = undefined;
    config.fixture.path = "tests/fixtures/signin.json";
    config.tracesDir = tracesDir;
    config.actionTimeoutMs = 80;
    const jev: JevClient = {
      async systemOne(): Promise<JevResponse> {
        return {
          answers: {
            screen: {
              type: "choice",
              choice: "none",
              probabilities: { s0: 0.05, s1: 0.05, none: 0.9 },
            },
          },
        };
      },
    };
    const driver = await FixtureDriver.fromFile("tests/fixtures/signin.json");
    const session = await createSession(config, "which timeout", { driver, jev });
    try {
      await expect(
        session.steps.which(["logged in on another device", "the home screen"]),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(NotFoundError);
        const message = (err as Error).message;
        expect(message).toMatch(/none of these screens appeared/);
        expect(message).toMatch(/on screen/);
        expect(message).toMatch(/Sign in/);
        expect(message).toMatch(/none\s+[█░]+\s+0\.90/);
        expect(message).toMatch(/waited/);
        expect(message).not.toMatch(/NOT FOUND|last screen:|last pick:/);
        return true;
      });
    } finally {
      await session.tracer.finish("fail");
      await session.close();
    }
  });

  it("which accepts a 0.7 vs 0.2 split instead of requiring 0.85 yes", async () => {
    const tracesDir = await mkdtemp(path.join(os.tmpdir(), "convoy-"));
    dirs.push(tracesDir);
    const config = await loadConfig();
    config.platform = "fixture";
    config.jev.mode = "heuristic";
    config.fixture.path = "tests/fixtures/signin.json";
    config.tracesDir = tracesDir;
    const jev: JevClient = {
      async systemOne(): Promise<JevResponse> {
        return {
          answers: {
            screen: {
              type: "choice",
              choice: "s0",
              probabilities: { s0: 0.7, s1: 0.2, none: 0.1 },
            },
          },
        };
      },
    };
    const driver = await FixtureDriver.fromFile("tests/fixtures/signin.json");
    const session = await createSession(config, "which split", { driver, jev });
    try {
      const screen = await session.steps.which([
        "logged in on another device",
        "the home screen",
      ]);
      expect(screen).toBe("logged in on another device");
    } finally {
      await session.tracer.finish("pass");
      await session.close();
    }
  });
});
