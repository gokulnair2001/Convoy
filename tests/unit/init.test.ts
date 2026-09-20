import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectEnvironment,
  initCommand,
  type DetectDeps,
} from "../../src/cli/init.js";

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "convoy-init-"));
  dirs.push(dir);
  return dir;
}

const quiet: DetectDeps = {
  which: async () => undefined,
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
};

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function captureOutput() {
  const lines: string[] = [];
  const collect = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(collect);
  vi.spyOn(console, "error").mockImplementation(collect);
  return {
    text: () => stripAnsi(lines.join("\n")),
  };
}

describe("initCommand", () => {
  it("creates convoy.config.json and .env from template in an empty dir", async () => {
    const cwd = await tmpDir();
    const out = captureOutput();

    const code = await initCommand({ platform: "fixture", yes: true, cwd }, quiet);

    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, "convoy.config.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".env"))).toBe(true);
    expect(existsSync(path.join(cwd, "tests", "sample.e2e.ts"))).toBe(true);
    const sample = await readFile(path.join(cwd, "tests", "sample.e2e.ts"), "utf8");
    expect(sample).toContain('import { e2e } from "convoy-e2e"');

    const config = JSON.parse(await readFile(path.join(cwd, "convoy.config.json"), "utf8")) as {
      platform: string;
      tracesDir: string;
      reset: string;
      lifecycle: { install: boolean; launch: boolean; resetBetweenTests: boolean };
      app: { bundleId: string; package: string; displayName: string };
      ios: { bundleId: string; build: { when: string }; udid?: string };
      android: { package: string };
    };
    expect(config.platform).toBe("fixture");
    expect(config.tracesDir).toBe(".convoy/runs");
    expect(config.reset).toBe("relaunch");
    expect(config.lifecycle).toEqual({ install: true, launch: true, resetBetweenTests: true });
    expect(config.app.bundleId).toBe("com.example.app");
    expect(config.app.package).toBe("com.example.app");
    expect(config.ios.bundleId).toBe("com.example.app");
    expect(config.ios.build.when).toBe("missing");
    expect(config.ios.udid).toBeUndefined();
    expect(config.android.package).toBe("com.example.app");

    const env = await readFile(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^TYPESAFE_API_KEY=$/m);
    expect(env).toMatch(/^CONVOY_PLATFORM=fixture$/m);
    expect(env).toMatch(/CONVOY_IOS_UDID=/);
    expect(env).toMatch(/CONVOY_ANDROID_SERIAL=/);
    expect(env).toMatch(/Application secrets/);

    expect(out.text()).toMatch(/still needed in \.env/);
    expect(out.text()).toMatch(/TYPESAFE_API_KEY/);
    expect(out.text()).not.toMatch(/CONVOY_TEST_USER/);
    expect(out.text()).toMatch(/convoy doctor && convoy run/);
    expect(out.text()).toMatch(/application secrets/);
  });

  it("does not overwrite an existing .env", async () => {
    const cwd = await tmpDir();
    await writeFile(path.join(cwd, ".env"), "TYPESAFE_API_KEY=keep-me\n", "utf8");

    const code = await initCommand({ platform: "fixture", yes: true, cwd }, quiet);
    expect(code).toBe(0);
    const env = await readFile(path.join(cwd, ".env"), "utf8");
    expect(env).toContain("TYPESAFE_API_KEY=keep-me");
    expect(env).not.toContain("CONVOY_PLATFORM=fixture\n# Optional");
  });

  it("without --yes, does not overwrite existing convoy.config.json", async () => {
    const cwd = await tmpDir();
    await writeFile(path.join(cwd, "convoy.config.json"), `${JSON.stringify({ platform: "web" }, null, 2)}\n`, "utf8");
    const out = captureOutput();

    const code = await initCommand({ platform: "fixture", cwd }, quiet);
    expect(code).toBe(0);
    const config = JSON.parse(await readFile(path.join(cwd, "convoy.config.json"), "utf8")) as { platform: string };
    expect(config.platform).toBe("web");
    expect(out.text()).toMatch(/kept\s+convoy\.config\.json/);
  });

  it("with --yes, overwrites convoy.config.json but still keeps .env", async () => {
    const cwd = await tmpDir();
    await writeFile(path.join(cwd, "convoy.config.json"), `${JSON.stringify({ platform: "web" }, null, 2)}\n`, "utf8");
    await writeFile(path.join(cwd, ".env"), "TYPESAFE_API_KEY=keep-me\n", "utf8");
    const out = captureOutput();

    const code = await initCommand({ platform: "ios", yes: true, cwd }, quiet);
    expect(code).toBe(0);

    const config = JSON.parse(await readFile(path.join(cwd, "convoy.config.json"), "utf8")) as {
      platform: string;
      ios: { udid?: string };
    };
    expect(config.platform).toBe("ios");
    expect(config.ios.udid).toBeUndefined();

    const env = await readFile(path.join(cwd, ".env"), "utf8");
    expect(env).toBe("TYPESAFE_API_KEY=keep-me\n");
    expect(out.text()).toMatch(/wrote\s+convoy\.config\.json/);
    expect(out.text()).toMatch(/existing file kept/);
  });

  it("returns 1 for an invalid platform", async () => {
    const cwd = await tmpDir();
    const out = captureOutput();

    const code = await initCommand({ platform: "windows", yes: true, cwd }, quiet);
    expect(code).toBe(1);
    expect(out.text()).toMatch(/invalid --platform/);
    expect(existsSync(path.join(cwd, "convoy.config.json"))).toBe(false);
    expect(existsSync(path.join(cwd, ".env"))).toBe(false);
  });

  it("printed recap mentions still needed keys", async () => {
    const cwd = await tmpDir();
    const out = captureOutput();

    const code = await initCommand({ platform: "android", yes: true, cwd }, quiet);
    expect(code).toBe(0);
    const recap = out.text();
    expect(recap).toMatch(/wrote\s+convoy\.config\.json/);
    expect(recap).toMatch(/wrote\s+\.env/);
    expect(recap).toMatch(/still needed in \.env/);
    expect(recap).toContain("TYPESAFE_API_KEY");
    expect(recap).not.toContain("CONVOY_TEST_USER");
    expect(recap).toMatch(/application secrets/);
  });

  it("fills CONVOY_IOS_UDID in a new .env from a booted simulator, not config json", async () => {
    const cwd = await tmpDir();
    const deps: DetectDeps = {
      which: async () => undefined,
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({
          devices: {
            "iOS 18.0": [{ udid: "BOOT-UDID-1", state: "Booted" }, { udid: "SHUT-1", state: "Shutdown" }],
          },
        }),
        stderr: "",
      }),
    };

    const code = await initCommand({ platform: "ios", yes: true, cwd }, deps);
    expect(code).toBe(0);

    const env = await readFile(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^CONVOY_IOS_UDID=BOOT-UDID-1$/m);
    expect(env).toMatch(/^CONVOY_PLATFORM=ios$/m);

    const config = JSON.parse(await readFile(path.join(cwd, "convoy.config.json"), "utf8")) as { ios: { udid?: string } };
    expect(config.ios.udid).toBeUndefined();
  });

  it("suggests a detected UDID when .env already exists", async () => {
    const cwd = await tmpDir();
    await writeFile(path.join(cwd, ".env"), "TYPESAFE_API_KEY=\n", "utf8");
    const out = captureOutput();
    const deps: DetectDeps = {
      which: async () => undefined,
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({ devices: { "iOS 18.0": [{ udid: "SUGGEST-UDID", state: "Booted" }] } }),
        stderr: "",
      }),
    };

    const code = await initCommand({ platform: "ios", yes: true, cwd }, deps);
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, ".env"), "utf8")).toBe("TYPESAFE_API_KEY=\n");
    expect(out.text()).toMatch(/CONVOY_IOS_UDID=SUGGEST-UDID/);
  });

  it("does not overwrite an existing e2e test", async () => {
    const cwd = await tmpDir();
    const existing = path.join(cwd, "flows", "login.e2e.ts");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "// existing\n", "utf8");

    const code = await initCommand({ platform: "fixture", yes: true, cwd }, quiet);
    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, "tests", "sample.e2e.ts"))).toBe(false);
    expect(await readFile(existing, "utf8")).toBe("// existing\n");
  });

  it("returns 1 when cwd is not writable", async () => {
    const out = captureOutput();
    const code = await initCommand({ platform: "fixture", yes: true, cwd: path.join(os.tmpdir(), "convoy-init-missing", "nope") }, quiet);
    expect(code).toBe(1);
    expect(out.text()).toMatch(/cannot write/);
  });
});

describe("detectEnvironment", () => {
  it("reads a booted simulator UDID and tool paths from injected deps", async () => {
    const cwd = await tmpDir();
    const detected = await detectEnvironment(cwd, {
      which: async (command) => (command === "idb" ? "/opt/idb" : command === "adb" ? "/opt/adb" : undefined),
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({
          devices: { "iOS 17.0": [{ udid: "SIM-1", state: "Booted" }] },
        }),
        stderr: "",
      }),
    });
    expect(detected.nodeOk).toBe(true);
    expect(detected.idb).toBe("/opt/idb");
    expect(detected.adb).toBe("/opt/adb");
    expect(detected.iosUdid).toBe("SIM-1");
  });

  it("skips tool detection when commands fail", async () => {
    const cwd = await tmpDir();
    const detected = await detectEnvironment(cwd, {
      which: async () => {
        throw new Error("no which");
      },
      exec: async () => {
        throw new Error("no xcrun");
      },
    });
    expect(detected.idb).toBeUndefined();
    expect(detected.adb).toBeUndefined();
    expect(detected.iosUdid).toBeUndefined();
  });
});
