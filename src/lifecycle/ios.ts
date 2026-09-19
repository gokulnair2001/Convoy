import type { ConvoyConfig } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { toolReport } from "../core/failure.js";
import { installIosApp, launchIosApp } from "../drivers/ios.js";
import { expandEnv } from "../util/expand.js";
import type { LifecycleLogger } from "./logger.js";
import {
  maybeRunBuild,
  resolveLifecycleDeps,
  runOk,
  type ExecFn,
  type LifecycleDeps,
  type PrepareResult,
} from "./prepare.js";

export type { LifecycleDeps };

export async function prepareIos(
  config: ConvoyConfig,
  log: LifecycleLogger,
  deps: LifecycleDeps = {},
): Promise<PrepareResult> {
  const { exec: execFn, exists, which: find } = resolveLifecycleDeps(deps);
  const udid = await resolveIosUdid(config, execFn, log);

  if (config.ios.simulator.boot) {
    log.phase("booting simulator…");
    const started = Date.now();
    await bootSimulator(execFn, udid);
    log.done("simulator ready", Date.now() - started);
  }

  if (config.ios.simulator.open && config.headed) {
    log.phase("opening Simulator…");
    const started = Date.now();
    try {
      await execFn("open", ["-a", "Simulator"]);
    } catch {
      // headed visibility is best-effort
    }
    log.done("Simulator opened", Date.now() - started);
  }

  const appPath = config.ios.appPath ? expandEnv(config.ios.appPath) : undefined;
  await maybeRunBuild(config.ios.build, appPath, log, { exec: execFn, exists });

  const run = (command: string, args: string[], opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) =>
    runOk(execFn, command, args, opts);

  if (config.lifecycle.install && appPath && exists(appPath)) {
    log.phase("installing app…");
    const started = Date.now();
    await installIosApp(appPath, udid, { execOk: run, which: find });
    log.done("installed", Date.now() - started);
  }

  if (config.lifecycle.launch) {
    log.phase("launching app…");
    const started = Date.now();
    await launchIosApp(config.ios.bundleId, udid, { execOk: run, which: find });
    log.done("launched", Date.now() - started);
  }

  return { skipped: false, platform: "ios", detail: udid };
}

export async function resolveIosUdid(
  config: ConvoyConfig,
  execFn: ExecFn,
  log?: LifecycleLogger,
): Promise<string> {
  if (config.ios.udid) return expandEnv(config.ios.udid);

  log?.phase("resolving simulator…");
  const started = Date.now();
  const result = await execFn("xcrun", ["simctl", "list", "devices", "-j"]);
  if (result.code !== 0) {
    throw new ToolError(
      toolReport({
        command: "xcrun",
        args: ["simctl", "list", "devices", "-j"],
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
        title: "failed to list iOS simulators",
        hint: "install Xcode / Xcode Command Line Tools, then convoy doctor",
      }),
    );
  }
  const udid = pickIphoneUdid(result.stdout);
  if (!udid) {
    throw new ToolError({
      kind: "driver",
      title: "no iPhone simulator found",
      hint: "install Xcode, boot a simulator, or set CONVOY_IOS_UDID in .env",
      next: ["convoy doctor"],
    });
  }
  log?.done("simulator resolved", Date.now() - started);
  return udid;
}

export function pickIphoneUdid(json: string): string | undefined {
  let parsed: {
    devices?: Record<
      string,
      Array<{ udid?: string; name?: string; state?: string; isAvailable?: boolean }>
    >;
  };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return undefined;
  }
  const devices: Array<{ udid: string; state: string; isAvailable?: boolean }> = [];
  for (const list of Object.values(parsed.devices ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const device of list) {
      if (!device.udid || !device.name || !/iphone/i.test(device.name)) continue;
      devices.push({ udid: device.udid, state: device.state ?? "", isAvailable: device.isAvailable });
    }
  }
  const usable = devices.filter((d) => d.isAvailable !== false);
  return usable.find((d) => d.state === "Booted")?.udid ?? usable[0]?.udid;
}

function isAlreadyBooted(stdout: string, stderr: string): boolean {
  return /already booted|current state:\s*Booted/i.test(`${stdout}\n${stderr}`);
}

async function bootSimulator(execFn: ExecFn, udid: string): Promise<void> {
  const result = await execFn("xcrun", ["simctl", "boot", udid]);
  if (result.code === 0 || isAlreadyBooted(result.stdout, result.stderr)) return;
  throw new ToolError(
    toolReport({
      command: "xcrun",
      args: ["simctl", "boot", udid],
      code: result.code,
      stderr: result.stderr,
      stdout: result.stdout,
    }),
  );
}
