import type { ConvoyConfig } from "../core/config.js";
import { adbArgs, androidLaunchArgs } from "../drivers/android.js";
import { expandEnv } from "../util/expand.js";
import type { LifecycleLogger } from "./logger.js";
import {
  maybeRunBuild,
  resolveLifecycleDeps,
  runOk,
  type LifecycleDeps,
  type PrepareResult,
} from "./prepare.js";

export type { LifecycleDeps };

export async function prepareAndroid(
  config: ConvoyConfig,
  log: LifecycleLogger,
  deps: LifecycleDeps = {},
): Promise<PrepareResult> {
  const { exec: execFn, exists } = resolveLifecycleDeps(deps);
  const serial = config.android.serial ? expandEnv(config.android.serial) : undefined;

  if (config.android.emulator.boot) {
    log.phase("starting adb…");
    const started = Date.now();
    await runOk(execFn, "adb", ["start-server"]);
    const devices = await execFn("adb", adbArgs(serial, ["devices"]));
    if (devices.code !== 0 || !adbHasDevice(devices.stdout)) {
      log.warn("No Android device or emulator detected. Start an emulator (or attach a device) before running tests.");
    }
    log.done("adb ready", Date.now() - started);
  }

  const apkPath = config.android.apkPath ? expandEnv(config.android.apkPath) : undefined;
  await maybeRunBuild(config.android.build, apkPath, log, { exec: execFn, exists });

  if (config.lifecycle.install && apkPath) {
    log.phase("installing app…");
    const started = Date.now();
    await runOk(execFn, "adb", adbArgs(serial, ["install", "-r", apkPath]), { timeoutMs: 120_000 });
    log.done("installed", Date.now() - started);
  }

  if (config.lifecycle.launch) {
    log.phase("launching app…");
    const started = Date.now();
    await runOk(execFn, "adb", adbArgs(serial, androidLaunchArgs(config.android.package)));
    log.done("launched", Date.now() - started);
  }

  return { skipped: false, platform: "android", detail: serial ?? "adb" };
}

export function adbHasDevice(stdout: string): boolean {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .some((line) => /\s+device$/.test(line));
}
