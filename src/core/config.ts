import type { LogicalPlatform, Platform } from "./element.js";
import { DEFAULT_GATES, type Gates } from "./gate.js";

export type ResetStrategy = "relaunch" | "clear" | "reinstall";
export type JevMode = "live" | "heuristic" | "recorded";
export type BuildWhen = "missing" | "always" | "never";

export interface AppConfig {
  bundleId: string;
  package: string;
  displayName: string;
}

export interface BuildConfig {
  /** Shell command. Supports ${ENV} interpolation. */
  command?: string;
  /** Default `missing`: run only when the binary is not on disk. */
  when: BuildWhen;
}

export interface SimulatorConfig {
  /** Boot the simulator if it is shutdown. Default true. */
  boot: boolean;
  /** Open Simulator.app so headed runs are visible. Default true. */
  open: boolean;
}

export interface EmulatorConfig {
  boot: boolean;
}

export interface ReadyConfig {
  /** Intent passed to `see` after launch / reset. */
  see: string;
  timeoutMs: number;
}

export interface LifecycleConfig {
  /** Install the app binary once per run when a path is configured. */
  install: boolean;
  /** Launch the app once per run (device platforms). */
  launch: boolean;
  /** Call driver.reset() before each test so authors do not need beforeEach. */
  resetBetweenTests: boolean;
}

export interface WebServerConfig {
  command: string;
  url?: string;
  timeoutMs?: number;
}

export interface IosConfig {
  udid?: string;
  version?: string;
  bundleId: string;
  appPath?: string;
  simulator: SimulatorConfig;
  build: BuildConfig;
}

export interface AndroidConfig {
  serial?: string;
  package: string;
  apkPath?: string;
  emulator: EmulatorConfig;
  build: BuildConfig;
}

export interface WebConfig {
  baseUrl: string;
  headed: boolean;
  server?: WebServerConfig;
}

export interface FixtureConfig {
  path: string;
  emulatePlatform: LogicalPlatform;
}

export interface JevConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  mode: JevMode;
  recordedDir?: string;
  timeoutMs: number;
  /** Print each System One question and answer. Off unless CONVOY_DEBUG_JEV=1. */
  debug: boolean;
}

export interface ConvoyConfig {
  platform: Platform;
  headed: boolean;
  slowMoMs: number;
  stepMode: boolean;
  tag?: string;
  tracesDir: string;
  reset: ResetStrategy;
  /** How long tap/type/see wait for a control after a screen change (network, animation). */
  actionTimeoutMs: number;
  gates: Gates;
  app: AppConfig;
  ios: IosConfig;
  android: AndroidConfig;
  web: WebConfig;
  fixture: FixtureConfig;
  jev: JevConfig;
  lifecycle: LifecycleConfig;
  ready?: ReadyConfig;
}

export interface ConvoyConfigFile {
  platform?: Platform;
  headed?: boolean;
  tracesDir?: string;
  reset?: ResetStrategy;
  actionTimeoutMs?: number;
  gates?: Partial<Gates>;
  app?: Partial<AppConfig>;
  ios?: Partial<IosConfig>;
  android?: Partial<AndroidConfig>;
  web?: Partial<WebConfig>;
  fixture?: Partial<FixtureConfig>;
  jev?: Partial<JevConfig>;
  lifecycle?: Partial<LifecycleConfig>;
  ready?: Partial<ReadyConfig>;
}

const DEFAULT_APP: AppConfig = {
  bundleId: "com.example.app",
  package: "com.example.app",
  displayName: "Example App",
};

const DEFAULT_BUILD: BuildConfig = { when: "missing" };
const DEFAULT_SIMULATOR: SimulatorConfig = { boot: true, open: true };
const DEFAULT_EMULATOR: EmulatorConfig = { boot: true };
const DEFAULT_LIFECYCLE: LifecycleConfig = {
  install: true,
  launch: true,
  resetBetweenTests: true,
};

export function defaultConfig(): ConvoyConfig {
  return {
    platform: "fixture",
    headed: true,
    slowMoMs: 0,
    stepMode: false,
    tracesDir: ".convoy/runs",
    reset: "relaunch",
    actionTimeoutMs: 20_000,
    gates: { ...DEFAULT_GATES },
    app: { ...DEFAULT_APP },
    ios: {
      bundleId: DEFAULT_APP.bundleId,
      simulator: { ...DEFAULT_SIMULATOR },
      build: { ...DEFAULT_BUILD },
    },
    android: {
      package: DEFAULT_APP.package,
      emulator: { ...DEFAULT_EMULATOR },
      build: { ...DEFAULT_BUILD },
    },
    web: { baseUrl: "http://localhost:3000", headed: true },
    fixture: {
      path: "tests/fixtures/signin.json",
      emulatePlatform: "ios",
    },
    jev: {
      baseUrl: "https://api.typesafe.ai/v1",
      model: "jev-latest",
      mode: "heuristic",
      timeoutMs: 15_000,
      debug: false,
    },
    lifecycle: { ...DEFAULT_LIFECYCLE },
  };
}

export function applyEnv(config: ConvoyConfig, env: NodeJS.ProcessEnv = process.env): ConvoyConfig {
  const next: ConvoyConfig = structuredClone(config);

  if (env.CONVOY_PLATFORM) next.platform = env.CONVOY_PLATFORM as Platform;
  if (env.CONVOY_HEADED !== undefined) next.headed = parseBool(env.CONVOY_HEADED, next.headed);
  if (env.CONVOY_SLOW_MO) next.slowMoMs = Number(env.CONVOY_SLOW_MO) || 0;
  if (env.CONVOY_STEP !== undefined) next.stepMode = parseBool(env.CONVOY_STEP, next.stepMode);
  if (env.CONVOY_TAG) next.tag = env.CONVOY_TAG;
  if (env.CONVOY_TRACES_DIR) next.tracesDir = env.CONVOY_TRACES_DIR;
  if (env.CONVOY_RESET) next.reset = env.CONVOY_RESET as ResetStrategy;
  if (env.CONVOY_ACTION_TIMEOUT_MS) {
    next.actionTimeoutMs = Number(env.CONVOY_ACTION_TIMEOUT_MS) || next.actionTimeoutMs;
  }
  if (env.CONVOY_FIXTURE) next.fixture.path = env.CONVOY_FIXTURE;

  if (env.CONVOY_IOS_UDID) next.ios.udid = env.CONVOY_IOS_UDID;
  if (env.CONVOY_IOS_BUNDLE_ID) {
    next.ios.bundleId = env.CONVOY_IOS_BUNDLE_ID;
    next.app.bundleId = env.CONVOY_IOS_BUNDLE_ID;
  }
  if (env.CONVOY_IOS_VERSION) next.ios.version = env.CONVOY_IOS_VERSION;
  if (env.CONVOY_IOS_APP) next.ios.appPath = env.CONVOY_IOS_APP;
  if (env.CONVOY_IOS_BUILD) next.ios.build.command = env.CONVOY_IOS_BUILD;
  if (env.CONVOY_SIMULATOR_BOOT !== undefined) {
    next.ios.simulator.boot = parseBool(env.CONVOY_SIMULATOR_BOOT, next.ios.simulator.boot);
  }

  if (env.CONVOY_ANDROID_SERIAL) next.android.serial = env.CONVOY_ANDROID_SERIAL;
  if (env.CONVOY_ANDROID_PACKAGE) {
    next.android.package = env.CONVOY_ANDROID_PACKAGE;
    next.app.package = env.CONVOY_ANDROID_PACKAGE;
  }
  if (env.CONVOY_ANDROID_APK) next.android.apkPath = env.CONVOY_ANDROID_APK;
  if (env.CONVOY_ANDROID_BUILD) next.android.build.command = env.CONVOY_ANDROID_BUILD;

  if (env.CONVOY_WEB_BASE_URL) next.web.baseUrl = env.CONVOY_WEB_BASE_URL;
  next.web.headed = next.headed;
  if (env.CONVOY_WEB_SERVER) {
    next.web.server = {
      command: env.CONVOY_WEB_SERVER,
      url: env.CONVOY_WEB_BASE_URL ?? next.web.baseUrl,
      timeoutMs: next.web.server?.timeoutMs ?? 60_000,
    };
  }

  if (env.CONVOY_LIFECYCLE_INSTALL !== undefined) {
    next.lifecycle.install = parseBool(env.CONVOY_LIFECYCLE_INSTALL, next.lifecycle.install);
  }
  if (env.CONVOY_LIFECYCLE_LAUNCH !== undefined) {
    next.lifecycle.launch = parseBool(env.CONVOY_LIFECYCLE_LAUNCH, next.lifecycle.launch);
  }
  if (env.CONVOY_RESET_BETWEEN !== undefined) {
    next.lifecycle.resetBetweenTests = parseBool(env.CONVOY_RESET_BETWEEN, next.lifecycle.resetBetweenTests);
  }

  if (env.CONVOY_READY_SEE) {
    next.ready = {
      see: env.CONVOY_READY_SEE,
      timeoutMs: env.CONVOY_READY_TIMEOUT_MS
        ? Number(env.CONVOY_READY_TIMEOUT_MS) || 30_000
        : (next.ready?.timeoutMs ?? 30_000),
    };
  } else if (env.CONVOY_READY_TIMEOUT_MS && next.ready) {
    next.ready.timeoutMs = Number(env.CONVOY_READY_TIMEOUT_MS) || next.ready.timeoutMs;
  }

  if (env.TYPESAFE_API_KEY) next.jev.apiKey = env.TYPESAFE_API_KEY;
  if (env.TYPESAFE_BASE_URL) next.jev.baseUrl = env.TYPESAFE_BASE_URL.replace(/\/$/, "");
  if (env.TYPESAFE_MODEL) next.jev.model = env.TYPESAFE_MODEL;
  if (env.CONVOY_JEV_RECORDED_DIR) next.jev.recordedDir = env.CONVOY_JEV_RECORDED_DIR;

  if (env.CONVOY_GATE_PRESENCE) next.gates.presence = Number(env.CONVOY_GATE_PRESENCE);
  if (env.CONVOY_GATE_NONE) next.gates.none = Number(env.CONVOY_GATE_NONE);
  if (env.CONVOY_GATE_TARGET) next.gates.target = Number(env.CONVOY_GATE_TARGET);
  if (env.CONVOY_GATE_GAP) next.gates.gap = Number(env.CONVOY_GATE_GAP);
  if (env.CONVOY_GATE_ASSERTION) next.gates.assertion = Number(env.CONVOY_GATE_ASSERTION);

  if (env.CONVOY_JEV_MODE) {
    next.jev.mode = env.CONVOY_JEV_MODE as JevMode;
  } else if (next.jev.apiKey) {
    next.jev.mode = "live";
  }

  if (env.CONVOY_DEBUG_JEV !== undefined) {
    next.jev.debug = parseBool(env.CONVOY_DEBUG_JEV, next.jev.debug);
  }

  return next;
}

export function mergeConfig(base: ConvoyConfig, file: ConvoyConfigFile): ConvoyConfig {
  return {
    ...base,
    ...pickDefined(file, ["platform", "headed", "tracesDir", "reset", "actionTimeoutMs"]),
    gates: { ...base.gates, ...file.gates },
    app: { ...base.app, ...file.app },
    ios: {
      ...base.ios,
      ...file.ios,
      simulator: { ...base.ios.simulator, ...file.ios?.simulator },
      build: { ...base.ios.build, ...file.ios?.build },
    },
    android: {
      ...base.android,
      ...file.android,
      emulator: { ...base.android.emulator, ...file.android?.emulator },
      build: { ...base.android.build, ...file.android?.build },
    },
    web: { ...base.web, ...file.web },
    fixture: { ...base.fixture, ...file.fixture },
    jev: { ...base.jev, ...file.jev },
    lifecycle: { ...base.lifecycle, ...file.lifecycle },
    ready: file.ready || base.ready ? { see: "", timeoutMs: 30_000, ...base.ready, ...file.ready } : undefined,
  };
}

function pickDefined<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export function parseBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}
