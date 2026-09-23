import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/core/config.js";
import { cachedIdbWhich, ensureIdbCompanion, IosDriver } from "../../src/drivers/ios.js";

describe("cachedIdbWhich", () => {
  it("calls the underlying which once for idb", async () => {
    let calls = 0;
    const find = cachedIdbWhich(async (command) => {
      if (command === "idb") {
        calls += 1;
        return "/opt/idb";
      }
      return undefined;
    });
    expect(await find("idb")).toBe("/opt/idb");
    expect(await find("idb")).toBe("/opt/idb");
    expect(calls).toBe(1);
  });
});

describe("ensureIdbCompanion", () => {
  it("runs idb connect with the udid", async () => {
    const calls: { command: string; args: string[]; timeoutMs?: number }[] = [];
    await ensureIdbCompanion("UDID-1", {
      exec: async (command, args, opts) => {
        calls.push({ command, args, timeoutMs: opts?.timeoutMs });
        return { code: 0, stdout: "UDID-1", stderr: "" };
      },
      which: async () => "/usr/local/bin/idb",
    });
    expect(calls).toEqual([{ command: "idb", args: ["connect", "UDID-1"], timeoutMs: 10_000 }]);
  });

  it("does not throw when the warm-up command fails", async () => {
    const warnings: string[] = [];
    await expect(
      ensureIdbCompanion("UDID-1", {
        exec: async () => ({ code: 1, stdout: "", stderr: "companion failed" }),
        which: async () => "/usr/local/bin/idb",
        log: { warn: (label) => warnings.push(label) },
      }),
    ).resolves.toBeUndefined();
    expect(warnings.some((w) => /companion/i.test(w))).toBe(true);
  });

  it("does not throw when execOk rejects", async () => {
    await expect(
      ensureIdbCompanion("UDID-1", {
        execOk: async () => {
          throw new Error("idb connect failed");
        },
        which: async () => "/usr/local/bin/idb",
      }),
    ).resolves.toBeUndefined();
  });

  it("skips when idb is not on PATH", async () => {
    const calls: string[] = [];
    await ensureIdbCompanion("UDID-1", {
      exec: async (command) => {
        calls.push(command);
        return { code: 0, stdout: "", stderr: "" };
      },
      which: async () => undefined,
    });
    expect(calls).toEqual([]);
  });
});

describe("IosDriver idb which cache", () => {
  it("does not call which twice for two consecutive idb operations", async () => {
    let whichCalls = 0;
    const driver = new IosDriver(defaultConfig().ios, "clear", {
      which: async (command) => {
        if (command === "idb") {
          whichCalls += 1;
          return "/opt/idb";
        }
        return undefined;
      },
      execOk: async () => "[]",
    });
    await driver.snapshot();
    await driver.snapshot();
    expect(whichCalls).toBe(1);
  });
});
