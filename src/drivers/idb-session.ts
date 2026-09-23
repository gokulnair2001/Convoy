import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { thisPackageRoot } from "../util/package-root.js";

/** Channel / process failure — driver may reconnect once, then fall back to the CLI. */
export class IdbGrpcTransportError extends Error {
  readonly name = "IdbGrpcTransportError";
}

export type IdbOp =
  | { op: "describe-all" }
  | { op: "tap"; x: number; y: number }
  | { op: "text"; text: string }
  | { op: "screenshot"; dest?: string }
  | { op: "key"; keycode: number; command?: boolean }
  | { op: "set-value"; x: number; y: number; value: string }
  | { op: "swipe"; x1: number; y1: number; x2: number; y2: number }
  | { op: "terminate"; bundle: string }
  | { op: "uninstall"; bundle: string }
  | { op: "launch"; bundle: string }
  | { op: "install"; path: string }
  | { op: "ping" };

export interface IdbGrpcCall {
  (op: IdbOp, opts?: { timeoutMs?: number }): Promise<string>;
}

export interface IdbGrpcSession {
  call: IdbGrpcCall;
  close(): Promise<void>;
}

export type SpawnBridge = (
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcessWithoutNullStreams;

/** Map an `idb` CLI argv (no binary, no --udid) onto a gRPC op. Undefined → stay on CLI. */
export function mapIdbArgsToOp(args: string[]): IdbOp | undefined {
  if (args[0] === "ui" && args[1] === "describe-all") return { op: "describe-all" };
  if (args[0] === "ui" && args[1] === "tap" && args[2] != null && args[3] != null) {
    return { op: "tap", x: Number(args[2]), y: Number(args[3]) };
  }
  if (args[0] === "ui" && args[1] === "text" && args[2] != null) {
    return { op: "text", text: args.slice(2).join(" ") };
  }
  if (args[0] === "ui" && args[1] === "swipe" && args.length >= 6) {
    return {
      op: "swipe",
      x1: Number(args[2]),
      y1: Number(args[3]),
      x2: Number(args[4]),
      y2: Number(args[5]),
    };
  }
  if (args[0] === "ui" && args[1] === "key") {
    if (args[2] === "--command" && args[3] != null) {
      return { op: "key", keycode: Number(args[3]), command: true };
    }
    if (args[2] != null) return { op: "key", keycode: Number(args[2]) };
  }
  if (args[0] === "ui" && args[1] === "set-value") {
    const valueIdx = args.indexOf("--value");
    const value = valueIdx >= 0 ? (args[valueIdx + 1] ?? "") : "";
    const nums = args.filter((a, i) => {
      if (a === "ui" || a === "set-value" || a === "--value") return false;
      if (valueIdx >= 0 && i === valueIdx + 1) return false;
      return true;
    });
    if (nums.length >= 2) {
      return { op: "set-value", x: Number(nums[0]), y: Number(nums[1]), value };
    }
  }
  if (args[0] === "screenshot" && args[1]) return { op: "screenshot", dest: args[1] };
  if (args[0] === "terminate" && args[1]) return { op: "terminate", bundle: args[1] };
  if (args[0] === "uninstall" && args[1]) return { op: "uninstall", bundle: args[1] };
  if (args[0] === "launch" && args[1]) return { op: "launch", bundle: args[1] };
  if (args[0] === "install" && args[1]) return { op: "install", path: args[1] };
  return undefined;
}

export function resolveIdbBridgeScript(fromMetaUrl: string = import.meta.url): string {
  const root = thisPackageRoot(fromMetaUrl);
  const src = path.join(root, "src/drivers/idb-bridge.py");
  if (existsSync(src)) return src;
  return path.join(root, "dist/drivers/idb-bridge.py");
}

/** Python that ships with the `idb` CLI (Homebrew shebang), else python3. */
export function pythonForIdb(idbBin: string): string {
  try {
    const first = readFileSync(idbBin, "utf8").split("\n")[0] ?? "";
    if (first.startsWith("#!")) {
      const parts = first.slice(2).trim().split(/\s+/);
      if (parts[0]?.endsWith("/env") && parts[1]) return parts[1];
      if (parts[0]) return parts[0];
    }
  } catch {
    // binary or unreadable
  }
  return "python3";
}

export async function openIdbGrpcSession(opts: {
  udid?: string;
  idbBin: string;
  spawn?: SpawnBridge;
  pythonBin?: string;
  scriptPath?: string;
  readyTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<IdbGrpcSession | undefined> {
  const script = opts.scriptPath ?? resolveIdbBridgeScript();
  if (!existsSync(script)) return undefined;
  const python = opts.pythonBin ?? pythonForIdb(opts.idbBin);
  const spawnFn = opts.spawn ?? (spawn as SpawnBridge);
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  if (opts.udid) env.IDB_UDID = opts.udid;

  const boot = async (): Promise<LiveBridge | undefined> => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnFn(python, [script, ...(opts.udid ? [opts.udid] : [])], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return undefined;
    }
    child.stderr?.resume();
    const live = new LiveBridge(child);
    if (!(await live.waitReady(opts.readyTimeoutMs ?? 15_000))) {
      live.kill();
      return undefined;
    }
    return live;
  };

  let live = await boot();
  if (!live) return undefined;
  let reconnecting = false;

  const call: IdbGrpcCall = async (op, callOpts) => {
    const timeout = callOpts?.timeoutMs ?? 30_000;
    try {
      return await live!.request(op, timeout);
    } catch (err) {
      if (!(err instanceof IdbGrpcTransportError) || reconnecting) throw err;
      reconnecting = true;
      try {
        live?.kill();
        live = await boot();
        if (!live) throw new IdbGrpcTransportError("idb gRPC helper reconnect failed");
        return await live.request(op, timeout);
      } finally {
        reconnecting = false;
      }
    }
  };

  return {
    call,
    close: async () => {
      live?.kill();
      live = undefined;
    },
  };
}

class LiveBridge {
  private buf = "";
  private nextId = 1;
  private ready: boolean | undefined;
  private readonly readyWaiters: Array<(ok: boolean) => void> = [];
  private readonly pending = new Map<
    number,
    { resolve: (line: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();
  private dead = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.push(chunk));
    const die = (message: string) => {
      this.dead = true;
      this.finishReady(false);
      for (const [, p] of this.pending) p.reject(new IdbGrpcTransportError(message));
      this.pending.clear();
    };
    child.on("close", () => die("idb gRPC helper exited"));
    child.on("error", (err) => die(err instanceof Error ? err.message : "idb gRPC helper error"));
  }

  waitReady(timeoutMs: number): Promise<boolean> {
    if (this.ready === true) return Promise.resolve(true);
    if (this.ready === false || this.dead) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finishReady(false);
      }, timeoutMs);
      this.readyWaiters.push((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  request(op: IdbOp, timeoutMs: number): Promise<string> {
    if (this.dead) return Promise.reject(new IdbGrpcTransportError("idb gRPC helper is not running"));
    const id = this.nextId;
    this.nextId += 1;
    const dest = op.op === "screenshot" ? op.dest : undefined;
    const body: Record<string, unknown> = { id, ...op };
    delete body.dest;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IdbGrpcTransportError(`idb gRPC ${op.op} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (line) => {
          clearTimeout(timer);
          void this.finishCall(op, dest, line, resolve, reject);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(`${JSON.stringify(body)}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new IdbGrpcTransportError(err.message));
        }
      });
    });
  }

  kill(): void {
    this.dead = true;
    this.finishReady(false);
    if (!this.child.killed) this.child.kill("SIGTERM");
  }

  private push(chunk: string): void {
    this.buf += chunk;
    let nl = this.buf.indexOf("\n");
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.startsWith("{")) this.onLine(line);
      nl = this.buf.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.ready === true && parsed.ok === true) {
      this.finishReady(true);
      return;
    }
    if (parsed.ready === false) {
      this.finishReady(false);
      return;
    }
    const id = parsed.id;
    if (typeof id !== "number") return;
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    waiter.resolve(parsed);
  }

  private finishReady(ok: boolean): void {
    if (this.ready !== undefined) return;
    this.ready = ok;
    const waiters = this.readyWaiters.splice(0);
    for (const w of waiters) w(ok);
  }

  private async finishCall(
    op: IdbOp,
    dest: string | undefined,
    line: Record<string, unknown>,
    resolve: (value: string) => void,
    reject: (err: Error) => void,
  ): Promise<void> {
    if (!line.ok) {
      reject(new Error(String(line.error ?? `idb gRPC ${op.op} failed`)));
      return;
    }
    try {
      if (op.op === "screenshot") {
        const b64 = String(line.b64 ?? "");
        const buf = Buffer.from(b64, "base64");
        if (dest) await writeFile(dest, buf);
        resolve(b64);
        return;
      }
      resolve(typeof line.stdout === "string" ? line.stdout : "");
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
