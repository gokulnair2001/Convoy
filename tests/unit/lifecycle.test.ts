import { describe, expect, it } from "vitest";
import type { AndroidConfig, ConvoyConfig } from "../../src/core/config.js";
import { defaultConfig } from "../../src/core/config.js";
import { reinstallAndroidApp, requireAndroidApk } from "../../src/drivers/android.js";
import { prepareAndroid } from "../../src/lifecycle/android.js";
import { prepareIos } from "../../src/lifecycle/ios.js";
import { silentLogger } from "../../src/lifecycle/logger.js";
import { prepareEnvironment, type ExecFn } from "../../src/lifecycle/prepare.js";
import { prepareWeb } from "../../src/lifecycle/web.js";
import { shouldResetBetweenTests } from "../../src/runner/e2e.js";
import type { ExecResult } from "../../src/util/exec.js";

interface RecordedCall {
  command: string;
  args: string[];
}

function recordingExec(
  impl?: (command: string, args: string[]) => ExecResult | Promise<ExecResult>,
): { exec: ExecFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: ExecFn = async (command, args) => {
    calls.push({ command, args });
    if (impl) return impl(command, args);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

function iosConfig(overrides: Partial<ConvoyConfig["ios"]> = {}): ConvoyConfig {
  const config = defaultConfig();
  config.platform = "ios";
  config.headed = false;
  config.ios = {
    ...config.ios,
    udid: "UDID-TEST",
    appPath: "/tmp/App.app",
    simulator: { boot: true, open: false },
    build: { when: "never" },
    ...overrides,
  };
  config.lifecycle.install = false;
  config.lifecycle.launch = false;
  return config;
}

function androidConfig(overrides: Partial<ConvoyConfig["android"]> = {}): ConvoyConfig {
  const config = defaultConfig();
  config.platform = "android";
  config.android = {
    ...config.android,
    apkPath: "/tmp/app.apk",
    emulator: { boot: false },
    build: { when: "never" },
    ...overrides,
  };
  config.lifecycle.install = true;
  config.lifecycle.launch = false;
  return config;
}

describe("prepareEnvironment", () => {
  it("skips fixture mode without throwing", async () => {
    const result = await prepareEnvironment(defaultConfig(), silentLogger);
    expect(result).toEqual({ skipped: true, platform: "fixture", detail: "fixture" });
  });
});

describe("prepareIos", () => {
  it("treats an already-booted simulator as success", async () => {
    const { exec, calls } = recordingExec(async (_command, args) => {
      if (args.includes("boot")) {
        return {
          code: 1,
          stdout: "",
          stderr: "Unable to boot device in current state: Booted",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(
      prepareIos(iosConfig(), silentLogger, { exec, exists: () => true }),
    ).resolves.toEqual({ skipped: false, platform: "ios", detail: "UDID-TEST" });

    expect(calls.some((c) => c.command === "xcrun" && c.args.includes("boot"))).toBe(true);
  });

  it("does not boot when simulator.boot is false", async () => {
    const { exec, calls } = recordingExec();
    await prepareIos(iosConfig({ simulator: { boot: false, open: false } }), silentLogger, {
      exec,
      exists: () => true,
    });
    expect(calls.some((c) => c.args.includes("boot"))).toBe(false);
  });

  it("installs and launches via idb when appPath is set", async () => {
    const { exec, calls } = recordingExec();
    const config = iosConfig();
    config.lifecycle.install = true;
    config.lifecycle.launch = true;
    config.ios.simulator.boot = false;

    await prepareIos(config, silentLogger, {
      exec,
      exists: () => true,
      which: async (command) => (command === "idb" ? "/usr/local/bin/idb" : undefined),
    });

    expect(calls).toContainEqual({
      command: "idb",
      args: ["install", "/tmp/App.app", "--udid", "UDID-TEST"],
    });
    expect(calls).toContainEqual({
      command: "idb",
      args: ["launch", "com.example.app", "--udid", "UDID-TEST"],
    });
  });

  it("skips build when when=missing and the app exists", async () => {
    const { exec, calls } = recordingExec();
    await prepareIos(
      iosConfig({
        simulator: { boot: false, open: false },
        build: { command: "xcodebuild -scheme App", when: "missing" },
      }),
      silentLogger,
      { exec, exists: () => true },
    );
    expect(calls.some((c) => c.command === "sh")).toBe(false);
  });

  it("runs build when when=always", async () => {
    const { exec, calls } = recordingExec();
    await prepareIos(
      iosConfig({
        simulator: { boot: false, open: false },
        build: { command: "xcodebuild -scheme App", when: "always" },
      }),
      silentLogger,
      { exec, exists: () => true },
    );
    expect(calls).toContainEqual({
      command: "sh",
      args: ["-c", "xcodebuild -scheme App"],
    });
  });

  it("expands ${ENV} in the build command", async () => {
    const previous = process.env.CONVOY_IOS_UDID;
    process.env.CONVOY_IOS_UDID = "ABC-123";
    try {
      const { exec, calls } = recordingExec();
      await prepareIos(
        iosConfig({
          simulator: { boot: false, open: false },
          build: { command: "echo ${CONVOY_IOS_UDID}", when: "always" },
        }),
        silentLogger,
        { exec, exists: () => true },
      );
      expect(calls).toContainEqual({ command: "sh", args: ["-c", "echo ABC-123"] });
    } finally {
      if (previous === undefined) delete process.env.CONVOY_IOS_UDID;
      else process.env.CONVOY_IOS_UDID = previous;
    }
  });
});

describe("prepareAndroid", () => {
  it("installs using android.apkPath", async () => {
    const { exec, calls } = recordingExec();
    await prepareAndroid(androidConfig(), silentLogger, { exec, exists: () => true });
    expect(calls).toContainEqual({
      command: "adb",
      args: ["install", "-r", "/tmp/app.apk"],
    });
  });

  it("prefixes adb with -s when serial is set", async () => {
    const { exec, calls } = recordingExec();
    await prepareAndroid(androidConfig({ serial: "emulator-5554" }), silentLogger, {
      exec,
      exists: () => true,
    });
    expect(calls).toContainEqual({
      command: "adb",
      args: ["-s", "emulator-5554", "install", "-r", "/tmp/app.apk"],
    });
  });
});

describe("android reinstall reset", () => {
  const android: AndroidConfig = {
    package: "com.example.app",
    apkPath: "/tmp/app.apk",
    emulator: { boot: false },
    build: { when: "never" },
  };

  it("does not throw when apkPath is set", async () => {
    expect(requireAndroidApk(android)).toBe("/tmp/app.apk");
    const calls: string[][] = [];
    await reinstallAndroidApp(android, async (args) => {
      calls.push(args);
      return "";
    });
    expect(calls).toContainEqual(["install", "-r", "/tmp/app.apk"]);
    expect(calls.some((args) => args.includes("monkey"))).toBe(true);
  });

  it("throws when apkPath is missing", () => {
    expect(() => requireAndroidApk({ ...android, apkPath: undefined })).toThrow(/APK path/);
  });
});

describe("prepareWeb", () => {
  it("is a no-op when no server command is configured", async () => {
    const config = defaultConfig();
    config.platform = "web";
    await expect(prepareWeb(config, silentLogger)).resolves.toEqual({
      skipped: true,
      platform: "web",
      detail: "no server",
    });
  });
});

describe("shouldResetBetweenTests", () => {
  it("follows lifecycle.resetBetweenTests, including fixture", () => {
    const on = defaultConfig();
    expect(on.platform).toBe("fixture");
    expect(shouldResetBetweenTests(on)).toBe(true);

    const off = defaultConfig();
    off.lifecycle.resetBetweenTests = false;
    expect(shouldResetBetweenTests(off)).toBe(false);
  });
});
