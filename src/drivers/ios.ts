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
import {
  IdbGrpcTransportError,
  mapIdbArgsToOp,
  openIdbGrpcSession,
  type IdbGrpcSession,
} from "./idb-session.js";

export interface IosToolDeps {
  execOk?: (
    command: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<string>;
  exec?: (
    command: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  which?: (command: string) => Promise<string | undefined>;
  log?: { warn(label: string): void };
  /** Injected in tests. Production opens a long-lived Python gRPC helper. */
  openGrpcSession?: (opts: {
    udid?: string;
    idbBin: string;
  }) => Promise<IdbGrpcSession | undefined>;
}

/** fb-idb `connect` starts companion for a target; keep this short so prepare cannot hang. */
const IDB_COMPANION_TIMEOUT_MS = 10_000;

/**
 * Cache `which("idb")` so snapshot/tap/type do not spawn `which` on every call.
 * Injected `find` functions are wrapped the same way (one lookup per helper instance).
 */
export function cachedIdbWhich(
  find: (command: string) => Promise<string | undefined>,
): (command: string) => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return async (command: string) => {
    if (command !== "idb") return find(command);
    cached ??= find("idb");
    return cached;
  };
}

const defaultFindIdb = cachedIdbWhich(which);

function findIdb(deps: IosToolDeps): (command: string) => Promise<string | undefined> {
  return deps.which ?? defaultFindIdb;
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

/**
 * Start idb companion for `udid` if needed (`idb connect <udid>`).
 * Failures are ignored — the live gRPC helper (or CLI fallback) still talks to companion.
 */
export async function ensureIdbCompanion(udid: string, deps: IosToolDeps = {}): Promise<void> {
  const find = findIdb(deps);
  try {
    if (!(await find("idb"))) return;
    const args = ["connect", udid];
    const opts = { timeoutMs: IDB_COMPANION_TIMEOUT_MS, env: iosEnv(udid) };
    if (deps.exec) {
      const result = await deps.exec("idb", args, opts);
      if (result.code !== 0) deps.log?.warn("idb companion warm-up failed; continuing");
      return;
    }
    const run = deps.execOk ?? execOk;
    await run("idb", args, opts);
  } catch {
    deps.log?.warn("idb companion warm-up failed; continuing");
  }
}

export async function installIosApp(appPath: string, udid?: string, deps: IosToolDeps = {}): Promise<void> {
  const run = deps.execOk ?? execOk;
  const find = findIdb(deps);
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
  const find = findIdb(deps);
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
  private idbBin?: string;
  private grpc?: IdbGrpcSession;
  private grpcOpening?: Promise<IdbGrpcSession | undefined>;
  private grpcDisabled = false;
  private readonly findIdb: (command: string) => Promise<string | undefined>;
  private readonly run: NonNullable<IosToolDeps["execOk"]>;
  private readonly openGrpcSession?: IosToolDeps["openGrpcSession"];

  constructor(
    private readonly config: IosConfig,
    private readonly resetStrategy: ResetStrategy = "clear",
    deps: IosToolDeps = {},
  ) {
    this.findIdb = deps.which ? cachedIdbWhich(deps.which) : defaultFindIdb;
    this.run = deps.execOk ?? execOk;
    this.openGrpcSession = deps.openGrpcSession ?? (deps.execOk ? undefined : openIdbGrpcSession);
  }

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
    const session = this.grpc;
    this.grpc = undefined;
    this.grpcOpening = undefined;
    this.grpcDisabled = false;
    await session?.close();
    // companion stays running
  }

  async rawDump(): Promise<unknown> {
    const stdout = await this.idb(["ui", "describe-all", "--nested"], { timeoutMs: 60_000 });
    return JSON.parse(stdout) as unknown;
  }

  private async resolveIdbBin(): Promise<string> {
    if (this.idbBin !== undefined) return this.idbBin;
    this.idbBin = (await this.findIdb("idb")) ?? "idb";
    return this.idbBin;
  }

  private async grpcSession(): Promise<IdbGrpcSession | undefined> {
    if (this.grpcDisabled || !this.openGrpcSession) return undefined;
    if (this.grpc) return this.grpc;
    this.grpcOpening ??= (async () => {
      try {
        const session = await this.openGrpcSession!({
          udid: this.config.udid,
          idbBin: await this.resolveIdbBin(),
        });
        this.grpc = session;
        if (!session) this.grpcDisabled = true;
        return session;
      } catch {
        this.grpcDisabled = true;
        return undefined;
      }
    })();
    return this.grpcOpening;
  }

  private async idb(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
    const env = iosEnv(this.config.udid);
    const bin = await this.resolveIdbBin();
    const op = mapIdbArgsToOp(args);
    if (op) {
      const session = await this.grpcSession();
      if (session) {
        try {
          return await session.call(op, { timeoutMs: opts.timeoutMs });
        } catch (err) {
          if (!(err instanceof IdbGrpcTransportError)) throw err;
          this.grpcDisabled = true;
          this.grpc = undefined;
          await session.close().catch(() => undefined);
        }
      }
    }
    return this.run(bin, idbArgs(args, this.config.udid), { timeoutMs: opts.timeoutMs, env });
  }
}

function frameOf(el: Element): PixelFrame {
  const ref = el.ref as IosRef | undefined;
  if (ref?.frame) return ref.frame;
  return { x: 0, y: 0, width: 0, height: 0 };
}
