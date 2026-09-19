import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Driver } from "../core/driver.js";
import { EMPTY_PNG } from "../core/driver.js";
import { fieldHasText, type Element } from "../core/element.js";
import type { PixelFrame } from "../core/bounds.js";
import { centerOf } from "../core/bounds.js";
import type { IosConfig, ResetStrategy } from "../core/config.js";
import { normalizeIos } from "../core/normalize.js";
import { ToolError } from "../core/errors.js";
import { execOk, which } from "../util/exec.js";

export interface IosToolDeps {
  execOk?: (
    command: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<string>;
  which?: (command: string) => Promise<string | undefined>;
}

interface IosRef {
  platform: "ios";
  frame: PixelFrame;
  raw: unknown;
}

/** idb takes --udid after the subcommand, not as a global flag. */
export function idbArgs(args: string[], udid?: string): string[] {
  return udid ? [...args, "--udid", udid] : args;
}

/** USB HID: A = 4, Delete/Backspace = 42. Used with `idb ui key`. */
export const HID_KEY_A = "4";
export const HID_KEY_DELETE = "42";

function iosEnv(udid?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (udid) env.IDB_UDID = udid;
  return env;
}

export async function installIosApp(appPath: string, udid?: string, deps: IosToolDeps = {}): Promise<void> {
  const run = deps.execOk ?? execOk;
  const find = deps.which ?? which;
  const env = iosEnv(udid);
  if (await find("idb")) {
    await run("idb", idbArgs(["install", appPath], udid), { timeoutMs: 120_000, env });
    return;
  }
  if (!udid) {
    throw new ToolError({
      kind: "driver",
      title: "cannot install the iOS app",
      hint: "idb is not installed and no simulator UDID is set",
      next: ["install idb", "set CONVOY_IOS_UDID", "convoy doctor"],
    });
  }
  await run("xcrun", ["simctl", "install", udid, appPath], { timeoutMs: 120_000 });
}

export async function launchIosApp(bundleId: string, udid?: string, deps: IosToolDeps = {}): Promise<void> {
  const run = deps.execOk ?? execOk;
  const find = deps.which ?? which;
  const env = iosEnv(udid);
  if (await find("idb")) {
    await run("idb", idbArgs(["launch", bundleId], udid), { env });
    return;
  }
  if (!udid) {
    throw new ToolError({
      kind: "driver",
      title: "cannot launch the iOS app",
      hint: "idb is not installed and no simulator UDID is set",
      next: ["install idb", "set CONVOY_IOS_UDID", "convoy doctor"],
    });
  }
  await run("xcrun", ["simctl", "launch", udid, bundleId]);
}

export class IosDriver implements Driver {
  readonly kind = "ios" as const;
  private screen: PixelFrame = { x: 0, y: 0, width: 390, height: 844 };

  constructor(
    private readonly config: IosConfig,
    private readonly resetStrategy: ResetStrategy = "clear",
  ) {}

  async snapshot(): Promise<Element[]> {
    const stdout = await this.idb(["ui", "describe-all", "--nested"], { timeoutMs: 60_000 });
    const raw = JSON.parse(stdout) as unknown;
    const result = normalizeIos(raw, { screen: this.screen });
    this.screen = result.screen;
    return result.elements;
  }

  async tap(el: Element): Promise<void> {
    const frame = frameOf(el);
    const { x, y } = centerOf(frame);
    await this.idb(["ui", "tap", String(x), String(y)]);
  }

  async type(el: Element, text: string): Promise<void> {
    await this.tap(el);
    if (fieldHasText(el)) {
      await this.clearField(el);
      await this.tap(el);
    }
    await this.idb(["ui", "text", text]);
  }

  /** Replace existing AX value so `type` does not append to a pre-filled field. */
  private async clearField(el: Element): Promise<void> {
    const frame = frameOf(el);
    const { x, y } = centerOf(frame);
    try {
      await this.idb([
        "ui",
        "set-value",
        "--value",
        "",
        String(Math.round(x)),
        String(Math.round(y)),
      ]);
    } catch {
      await this.idb(["ui", "key", "--command", HID_KEY_A]);
      await this.idb(["ui", "key", HID_KEY_DELETE]);
    }
  }

  async reset(): Promise<void> {
    const bundle = this.config.bundleId;
    if (this.resetStrategy === "reinstall" && this.config.appPath) {
      await this.idb(["uninstall", bundle]).catch(() => undefined);
      await installIosApp(this.config.appPath, this.config.udid);
      await launchIosApp(bundle, this.config.udid);
      return;
    }
    if (this.resetStrategy === "clear" && this.config.appPath) {
      await this.idb(["terminate", bundle]).catch(() => undefined);
      await this.idb(["uninstall", bundle]).catch(() => undefined);
      await installIosApp(this.config.appPath, this.config.udid);
      await launchIosApp(bundle, this.config.udid);
      return;
    }
    await this.idb(["terminate", bundle]).catch(() => undefined);
    await launchIosApp(bundle, this.config.udid);
  }

  async screenshot(): Promise<Buffer> {
    const dest = path.join(os.tmpdir(), `convoy-ios-${Date.now()}.png`);
    try {
      await this.idb(["screenshot", dest]);
      return await readFile(dest);
    } catch {
      return EMPTY_PNG;
    } finally {
      await rm(dest, { force: true });
    }
  }

  async back(): Promise<void> {
    await this.idb(["ui", "swipe", "0", "200", "350", "200"]);
  }

  async close(): Promise<void> {
    // companion stays running
  }

  async rawDump(): Promise<unknown> {
    const stdout = await this.idb(["ui", "describe-all", "--nested"], { timeoutMs: 60_000 });
    return JSON.parse(stdout) as unknown;
  }

  private async idb(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
    const env = { ...process.env };
    if (this.config.udid) env.IDB_UDID = this.config.udid;
    return execOk("idb", idbArgs(args, this.config.udid), { timeoutMs: opts.timeoutMs, env });
  }
}

function frameOf(el: Element): PixelFrame {
  const ref = el.ref as IosRef | undefined;
  if (ref?.frame) return ref.frame;
  return { x: 0, y: 0, width: 0, height: 0 };
}
