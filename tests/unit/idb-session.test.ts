import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  IdbGrpcTransportError,
  mapIdbArgsToOp,
  openIdbGrpcSession,
  pythonForIdb,
  resolveIdbBridgeScript,
  type SpawnBridge,
} from "../../src/drivers/idb-session.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "convoy-idb-"));
  dirs.push(dir);
  return dir;
}

function fakeChild(opts: {
  ready?: Record<string, unknown> | "none";
  onReq?: (req: Record<string, unknown>) => Record<string, unknown> | "close";
}): ChildProcessWithoutNullStreams {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  let killed = false;
  Object.defineProperties(child, {
    stdout: { value: stdout },
    stdin: { value: stdin },
    stderr: { value: stderr },
    killed: { get: () => killed },
    kill: {
      value: () => {
        killed = true;
        child.emit("close", 0);
      },
    },
  });
  if (opts.ready !== "none") {
    const payload = opts.ready ?? { ok: true, ready: true };
    queueMicrotask(() => {
      stdout.write(`${JSON.stringify(payload)}\n`);
    });
  }
  stdin.on("data", (chunk: Buffer | string) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      const req = JSON.parse(line) as Record<string, unknown>;
      const res = opts.onReq?.(req) ?? { ok: true, stdout: "" };
      if (res === "close") {
        child.emit("close", 1);
        return;
      }
      stdout.write(`${JSON.stringify({ id: req.id, ...res })}\n`);
    }
  });
  return child;
}

describe("mapIdbArgsToOp", () => {
  it("maps describe-all including --nested", () => {
    expect(mapIdbArgsToOp(["ui", "describe-all", "--nested"])).toEqual({ op: "describe-all" });
  });

  it("maps tap, text, swipe, and keys", () => {
    expect(mapIdbArgsToOp(["ui", "tap", "10", "20"])).toEqual({ op: "tap", x: 10, y: 20 });
    expect(mapIdbArgsToOp(["ui", "text", "hello world"])).toEqual({ op: "text", text: "hello world" });
    expect(mapIdbArgsToOp(["ui", "swipe", "0", "200", "350", "200"])).toEqual({
      op: "swipe",
      x1: 0,
      y1: 200,
      x2: 350,
      y2: 200,
    });
    expect(mapIdbArgsToOp(["ui", "key", "42"])).toEqual({ op: "key", keycode: 42 });
    expect(mapIdbArgsToOp(["ui", "key", "--command", "4"])).toEqual({
      op: "key",
      keycode: 4,
      command: true,
    });
  });

  it("maps set-value, screenshot, and app lifecycle", () => {
    expect(mapIdbArgsToOp(["ui", "set-value", "--value", "", "12", "34"])).toEqual({
      op: "set-value",
      x: 12,
      y: 34,
      value: "",
    });
    expect(mapIdbArgsToOp(["screenshot", "/tmp/a.png"])).toEqual({
      op: "screenshot",
      dest: "/tmp/a.png",
    });
    expect(mapIdbArgsToOp(["terminate", "app.id"])).toEqual({ op: "terminate", bundle: "app.id" });
    expect(mapIdbArgsToOp(["uninstall", "app.id"])).toEqual({ op: "uninstall", bundle: "app.id" });
    expect(mapIdbArgsToOp(["launch", "app.id"])).toEqual({ op: "launch", bundle: "app.id" });
    expect(mapIdbArgsToOp(["install", "/tmp/App.app"])).toEqual({ op: "install", path: "/tmp/App.app" });
  });

  it("returns undefined for unmapped commands", () => {
    expect(mapIdbArgsToOp(["connect", "UDID"])).toBeUndefined();
    expect(mapIdbArgsToOp(["list"])).toBeUndefined();
  });
});

describe("pythonForIdb", () => {
  it("reads an absolute shebang from the idb CLI script", async () => {
    const dir = await tmpDir();
    const bin = path.join(dir, "idb");
    writeFileSync(bin, "#!/opt/homebrew/opt/python@3.12/bin/python3.12\nprint(1)\n");
    expect(pythonForIdb(bin)).toBe("/opt/homebrew/opt/python@3.12/bin/python3.12");
  });

  it("uses the interpreter after /usr/bin/env", async () => {
    const dir = await tmpDir();
    const bin = path.join(dir, "idb");
    writeFileSync(bin, "#!/usr/bin/env python3\nprint(1)\n");
    expect(pythonForIdb(bin)).toBe("python3");
  });

  it("falls back to python3 for a binary with no shebang", async () => {
    const dir = await tmpDir();
    const bin = path.join(dir, "idb");
    writeFileSync(bin, "not a script");
    expect(pythonForIdb(bin)).toBe("python3");
  });
});

describe("openIdbGrpcSession", () => {
  const scriptPath = resolveIdbBridgeScript();

  it("resolves the bridge next to this package", () => {
    expect(scriptPath.endsWith(`${path.sep}src${path.sep}drivers${path.sep}idb-bridge.py`)).toBe(true);
  });

  it("returns undefined when the helper script is missing", async () => {
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      scriptPath: path.join(os.tmpdir(), "convoy-missing-idb-bridge.py"),
    });
    expect(session).toBeUndefined();
  });

  it("returns undefined when ready never arrives", async () => {
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      readyTimeoutMs: 30,
      spawn: (() => fakeChild({ ready: "none" })) as SpawnBridge,
    });
    expect(session).toBeUndefined();
  });

  it("reuses one helper process for sequential ops", async () => {
    let spawns = 0;
    const ops: string[] = [];
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      spawn: (() => {
        spawns += 1;
        return fakeChild({
          onReq: (req) => {
            ops.push(String(req.op));
            if (req.op === "describe-all") return { ok: true, stdout: "[]" };
            return { ok: true };
          },
        });
      }) as SpawnBridge,
    });
    expect(session).toBeDefined();
    expect(await session!.call({ op: "describe-all" })).toBe("[]");
    expect(await session!.call({ op: "tap", x: 1, y: 2 })).toBe("");
    expect(spawns).toBe(1);
    expect(ops).toEqual(["describe-all", "tap"]);
    await session!.close();
  });

  it("reconnects once after the helper exits, then serves the op", async () => {
    let spawns = 0;
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      spawn: (() => {
        spawns += 1;
        if (spawns === 1) return fakeChild({ onReq: () => "close" });
        return fakeChild({ onReq: () => ({ ok: true, stdout: "recovered" }) });
      }) as SpawnBridge,
    });
    expect(await session!.call({ op: "describe-all" })).toBe("recovered");
    expect(spawns).toBe(2);
    await session!.close();
  });

  it("does not reconnect on an application error", async () => {
    let spawns = 0;
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      spawn: (() => {
        spawns += 1;
        return fakeChild({ onReq: () => ({ ok: false, error: "tap missed" }) });
      }) as SpawnBridge,
    });
    await expect(session!.call({ op: "tap", x: 1, y: 2 })).rejects.toThrow("tap missed");
    expect(spawns).toBe(1);
    await session!.close();
  });

  it("writes a screenshot dest from base64", async () => {
    const dir = await tmpDir();
    const dest = path.join(dir, "shot.png");
    mkdirSync(dir, { recursive: true });
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      spawn: (() =>
        fakeChild({
          onReq: () => ({ ok: true, b64: Buffer.from("png-bytes").toString("base64") }),
        })) as SpawnBridge,
    });
    await session!.call({ op: "screenshot", dest });
    expect(await readFile(dest, "utf8")).toBe("png-bytes");
    await session!.close();
  });

  it("throws IdbGrpcTransportError when reconnect also fails", async () => {
    const session = await openIdbGrpcSession({
      idbBin: "idb",
      pythonBin: "python3",
      scriptPath,
      spawn: (() => fakeChild({ onReq: () => "close" })) as SpawnBridge,
    });
    await expect(session!.call({ op: "ping" })).rejects.toBeInstanceOf(IdbGrpcTransportError);
    await session!.close();
  });
});
