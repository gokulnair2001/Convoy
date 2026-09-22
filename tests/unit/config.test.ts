import { describe, expect, it } from "vitest";
import {
  applyEnv,
  defaultConfig,
  mergeConfig,
  parseSessionStart,
  resolveEffectiveStart,
} from "../../src/core/config.js";

describe("config", () => {
  it("starts as a fixture-mode default with no hardcoded region", () => {
    const config = defaultConfig();
    expect(config.platform).toBe("fixture");
    expect(config.jev.baseUrl).toBe("https://api.typesafe.ai/v1");
    expect(config.jev.mode).toBe("heuristic");
    expect(config.gates.presence).toBe(0.9);
  });

  it("lets env override simulator, bundle, and EU API base URL", () => {
    const config = applyEnv(defaultConfig(), {
      CONVOY_PLATFORM: "ios",
      CONVOY_IOS_UDID: "UDID-1",
      CONVOY_IOS_BUNDLE_ID: "com.example.app",
      CONVOY_IOS_VERSION: "18.0",
      TYPESAFE_API_KEY: "secret",
      TYPESAFE_BASE_URL: "https://api.eu.typesafe.ai/v1/",
      CONVOY_JEV_MODE: "live",
    });
    expect(config.platform).toBe("ios");
    expect(config.ios.udid).toBe("UDID-1");
    expect(config.ios.bundleId).toBe("com.example.app");
    expect(config.ios.version).toBe("18.0");
    expect(config.jev.apiKey).toBe("secret");
    expect(config.jev.baseUrl).toBe("https://api.eu.typesafe.ai/v1");
    expect(config.jev.mode).toBe("live");
  });

  it("keeps Jev debug off unless CONVOY_DEBUG_JEV=1", () => {
    const live = applyEnv(defaultConfig(), {
      TYPESAFE_API_KEY: "secret",
      CONVOY_JEV_MODE: "live",
      VITEST: "true",
    });
    expect(live.jev.debug).toBe(false);

    const forced = applyEnv(defaultConfig(), {
      TYPESAFE_API_KEY: "secret",
      CONVOY_DEBUG_JEV: "1",
    });
    expect(forced.jev.debug).toBe(true);

    const off = applyEnv(defaultConfig(), {
      TYPESAFE_API_KEY: "secret",
      CONVOY_DEBUG_JEV: "0",
    });
    expect(off.jev.debug).toBe(false);
  });

  it("defaults reset to relaunch and merges lifecycle / ready / apk", () => {
    const base = defaultConfig();
    expect(base.reset).toBe("relaunch");
    expect(base.lifecycle.resetBetweenTests).toBe(true);
    expect(base.ios.simulator.boot).toBe(true);
    expect(base.jev.debug).toBe(false);

    const merged = mergeConfig(base, {
      ios: {
        appPath: "/tmp/App.app",
        simulator: { boot: false, open: true },
        build: { command: "xcodebuild", when: "always" },
      },
      android: { apkPath: "/tmp/app.apk" },
      ready: { see: "the login screen", timeoutMs: 45_000 },
      lifecycle: { install: true, launch: true, resetBetweenTests: false },
    });
    expect(merged.ios.appPath).toBe("/tmp/App.app");
    expect(merged.ios.simulator.boot).toBe(false);
    expect(merged.ios.build.command).toBe("xcodebuild");
    expect(merged.ios.build.when).toBe("always");
    expect(merged.android.apkPath).toBe("/tmp/app.apk");
    expect(merged.ready?.see).toBe("the login screen");
    expect(merged.lifecycle.resetBetweenTests).toBe(false);

    const envd = applyEnv(base, {
      CONVOY_ANDROID_APK: "/opt/app.apk",
      CONVOY_READY_SEE: "the home screen",
      CONVOY_DEBUG_JEV: "1",
    });
    expect(envd.android.apkPath).toBe("/opt/app.apk");
    expect(envd.ready?.see).toBe("the home screen");
    expect(envd.jev.debug).toBe(true);
  });

  it("does not promote heuristic to live when CONVOY_JEV_MODE is set", () => {
    const config = applyEnv(defaultConfig(), {
      TYPESAFE_API_KEY: "secret",
      CONVOY_JEV_MODE: "heuristic",
    });
    expect(config.jev.mode).toBe("heuristic");
  });

  it("merges file config over defaults", () => {
    const config = mergeConfig(defaultConfig(), {
      platform: "web",
      web: { baseUrl: "https://app.example.com", headed: false },
    });
    expect(config.platform).toBe("web");
    expect(config.web.baseUrl).toBe("https://app.example.com");
  });

  it("defaults session start to launch and screenshots to failure", () => {
    const config = defaultConfig();
    expect(config.sessionStart).toBe("launch");
    expect(config.sessionStartLocked).toBe(false);
    expect(config.traceScreenshots).toBe("failure");
  });

  it("locks session start from CONVOY_START so a file cannot override", () => {
    const locked = applyEnv(defaultConfig(), { CONVOY_START: "attach" });
    expect(locked.sessionStart).toBe("attach");
    expect(locked.sessionStartLocked).toBe(true);
    expect(resolveEffectiveStart(locked, "launch")).toBe("attach");

    const unlocked = defaultConfig();
    expect(resolveEffectiveStart(unlocked, "attach")).toBe("attach");
    expect(resolveEffectiveStart(unlocked)).toBe("launch");
  });

  it("parses session start and ignores junk", () => {
    expect(parseSessionStart("launch")).toBe("launch");
    expect(parseSessionStart("ATTACH")).toBe("attach");
    expect(parseSessionStart("reuse")).toBeUndefined();
  });

  it("merges sessionStart and traceScreenshots from file config", () => {
    const config = mergeConfig(defaultConfig(), {
      sessionStart: "attach",
      traceScreenshots: "all",
    });
    expect(config.sessionStart).toBe("attach");
    expect(config.traceScreenshots).toBe("all");
    expect(config.sessionStartLocked).toBe(false);
  });
});
