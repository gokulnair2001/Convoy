import { existsSync } from "node:fs";
import type { BuildConfig, ConvoyConfig } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { toolReport } from "../core/failure.js";
import { expandEnv } from "../util/expand.js";
import { exec, type ExecResult } from "../util/exec.js";
import { silentLogger, type LifecycleLogger } from "./logger.js";

export interface PrepareResult {
  skipped: boolean;
  platform: ConvoyConfig["platform"];
  detail?: string;
}

export type ExecFn = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** Injectable command / filesystem hooks so unit tests never call real xcrun, idb, or adb. */
export interface LifecycleDeps {
  exec?: ExecFn;
  which?: (command: string) => Promise<string | undefined>;
  exists?: (path: string) => boolean;
  fetch?: typeof fetch;
  spawn?: typeof import("node:child_process").spawn;
}

export function resolveLifecycleDeps(deps: LifecycleDeps = {}): {
  exec: ExecFn;
  exists: (path: string) => boolean;
  which: (command: string) => Promise<string | undefined>;
} {
  const execFn = deps.exec ?? exec;
  const existsFn = deps.exists ?? existsSync;
  const whichFn =
    deps.which ??
    (async (command: string) => {
      try {
        const result = await execFn("which", [command]);
        if (result.code === 0) {
          const trimmed = result.stdout.trim();
          return trimmed || undefined;
        }
      } catch {
        return undefined;
      }
      return undefined;
    });
  return { exec: execFn, exists: existsFn, which: whichFn };
}

export async function runOk(
  execFn: ExecFn,
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const result = await execFn(command, args, opts);
  if (result.code !== 0) {
    throw new ToolError(
      toolReport({
        command,
        args,
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
      }),
    );
  }
  return result.stdout;
}

export async function maybeRunBuild(
  build: BuildConfig,
  binaryPath: string | undefined,
  log: LifecycleLogger,
  deps: { exec: ExecFn; exists: (path: string) => boolean },
): Promise<void> {
  if (!build.command) return;
  if (build.when === "never") return;
  if (build.when === "missing" && !binaryMissing(binaryPath, deps.exists)) return;
  log.phase("building app…");
  const started = Date.now();
  const result = await deps.exec("sh", ["-c", expandEnv(build.command)], { timeoutMs: 600_000 });
  if (result.code !== 0) {
    throw new ToolError(
      toolReport({
        command: "sh",
        args: ["-c", build.command],
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
        title: `build failed (exit ${result.code})`,
        hint: "the build command exited non-zero — check the detail, then fix ios.build.command / android.build.command",
      }),
    );
  }
  log.done("built", Date.now() - started);
}

/**
 * Once-per-run device/app setup: boot simulator, optional build, install, launch.
 * Fixture mode is a no-op. Platform work lives in `./ios.ts`, `./android.ts`, `./web.ts`.
 */
export async function prepareEnvironment(
  config: ConvoyConfig,
  log: LifecycleLogger = silentLogger,
): Promise<PrepareResult> {
  if (config.platform === "fixture") {
    log.done("fixture (no device)");
    return { skipped: true, platform: "fixture", detail: "fixture" };
  }

  if (config.platform === "ios") {
    const { prepareIos } = await import("./ios.js");
    return prepareIos(config, log);
  }
  if (config.platform === "android") {
    const { prepareAndroid } = await import("./android.js");
    return prepareAndroid(config, log);
  }
  const { prepareWeb } = await import("./web.js");
  return prepareWeb(config, log);
}

export function binaryMissing(
  path: string | undefined,
  exists: (p: string) => boolean = existsSync,
): boolean {
  if (!path) return true;
  return !exists(path);
}
