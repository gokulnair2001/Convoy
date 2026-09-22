import { beforeEach as vitestBeforeEach, test } from "vitest";
import { resolveEffectiveStart, type ConvoyConfig, type SessionStart } from "../core/config.js";
import { loadConfig } from "../core/load-config.js";
import { ConvoyError } from "../core/errors.js";
import type { LifecycleLogger } from "../lifecycle/logger.js";
import { prepareEnvironment } from "../lifecycle/prepare.js";
import { createSession, type Session } from "./session.js";
import { rethrowWithTrace, type Steps } from "./steps.js";

export function shouldResetBetweenTests(config: ConvoyConfig): boolean {
  return config.lifecycle.resetBetweenTests;
}

/** Whether this journey relaunches (reset + ready.see). Attach keeps the current screen. */
export function shouldLaunchJourney(
  config: ConvoyConfig,
  fileStart?: SessionStart,
): { reset: boolean; readySee: boolean } {
  const start = resolveEffectiveStart(config, fileStart);
  if (start !== "launch") {
    return { reset: false, readySee: false };
  }
  return {
    reset: shouldResetBetweenTests(config),
    readySee: Boolean(config.ready?.see),
  };
}

const prepareLog: LifecycleLogger = {
  phase(label) {
    console.log(`prepare: ${label}`);
  },
  done(label, ms) {
    console.log(ms != null ? `prepare: ${label} (${ms}ms)` : `prepare: ${label}`);
  },
  warn(label) {
    console.warn(`prepare: ${label}`);
  },
};

let prepared: Promise<unknown> | undefined;

async function ensurePrepared(config: ConvoyConfig): Promise<void> {
  if (process.env.CONVOY_PREPARED === "1") return;
  prepared ??= prepareEnvironment(config, prepareLog);
  try {
    await prepared;
  } catch (err) {
    if (err instanceof ConvoyError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ConvoyError({
      kind: "driver",
      title: `failed to prepare the ${config.platform} environment`,
      hint: message,
      next: ["convoy doctor"],
    });
  }
}

export type E2eFn = (t: Steps) => Promise<void>;

export interface E2eOptions {
  platforms?: Array<"ios" | "android" | "web">;
  tags?: string[];
  fixture?: string;
  /** File-level start. CLI lock (`sessionStartLocked`) still wins. */
  start?: SessionStart;
  /** Authoring file shown in failures. YAML register sets this; TS infers from the stack. */
  file?: string;
}

const hooksByFile = new Map<string, E2eFn[]>();

export function e2e(name: string, opts: E2eOptions, fn: E2eFn): void;
export function e2e(name: string, fn: E2eFn): void;
export function e2e(name: string, optsOrFn: E2eOptions | E2eFn, maybeFn?: E2eFn): void {
  const opts: E2eOptions = typeof optsOrFn === "function" ? {} : optsOrFn;
  const fn: E2eFn = typeof optsOrFn === "function" ? optsOrFn : maybeFn!;
  registerTest(name, opts, async (session) => {
    await fn(session.steps);
  });
}

/**
 * One app session, ordered steps. Use this when the next step needs the
 * screen produced by the previous one (email → Continue → password).
 *
 * `tap`/`type` wait for that screen (up to CONVOY_ACTION_TIMEOUT_MS).
 * Do not use a separate `e2e()` per step — each `e2e()` resets the app.
 */
e2e.serial = (name: string, opts: E2eOptions, define: (step: (stepName: string, fn: E2eFn) => void) => void): void => {
  const steps: Array<{ name: string; fn: E2eFn }> = [];
  define((stepName, fn) => {
    steps.push({ name: stepName, fn });
  });
  registerTest(name, opts, async (session) => {
    for (const step of steps) {
      await step.fn(session.steps);
      session.reporter.pass(`${name} › ${step.name}`);
    }
  });
};

e2e.beforeEach = (fn: E2eFn): void => {
  const file = callerFile();
  const hooks = hooksByFile.get(file) ?? [];
  hooks.push(fn);
  hooksByFile.set(file, hooks);
  vitestBeforeEach(() => undefined);
};

function registerTest(
  name: string,
  opts: E2eOptions,
  body: (session: Session) => Promise<void>,
): void {
  const file = opts.file ?? callerFile();
  const current = process.env.CONVOY_PLATFORM ?? "fixture";
  const tag = process.env.CONVOY_TAG;
  const skipTag = Boolean(tag && !(opts.tags ?? []).includes(tag));
  const skipPlatform =
    current !== "fixture" &&
    Boolean(opts.platforms) &&
    !opts.platforms!.includes(current as "ios" | "android" | "web");

  const impl = async () => {
    const config = await loadConfig();
    if (opts.fixture) config.fixture.path = opts.fixture;
    await ensurePrepared(config);
    const session: Session = await createSession(config, name);
    try {
      session.reporter.beginTest(name);
      const { reset, readySee } = shouldLaunchJourney(config, opts.start);
      if (reset) {
        await session.steps.resetApp();
      }
      if (readySee && config.ready?.see) {
        await session.steps.see(config.ready.see);
      }
      const hooks = hooksByFile.get(file) ?? [];
      for (const hook of hooks) await hook(session.steps);
      await body(session);
      await session.steps.flush();
      await session.tracer.finish("pass");
      session.reporter.pass(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await session.tracer.finish("fail", message).catch(() => undefined);
      if (err instanceof ConvoyError || err instanceof Error) {
        rethrowWithTrace(err, name, file, session.reporter);
      }
      throw err;
    } finally {
      await session.close();
    }
  };

  if (skipTag || skipPlatform) {
    test.skip(name, impl);
    return;
  }
  test(name, impl);
}

function callerFile(): string {
  const stack = new Error().stack ?? "";
  const line = stack.split("\n").find((l) => /\.(e2e|test)\.(ts|yaml|yml)/.test(l));
  return line?.replace(/^\s*at\s+/, "") ?? "unknown";
}
