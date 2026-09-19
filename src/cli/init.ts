import { constants, existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { thisPackageRoot, readPackageJson } from "../util/package-root.js";
import pc from "picocolors";
import { exec, which, type ExecResult } from "../util/exec.js";

export interface InitOptions {
  platform?: string;
  yes?: boolean;
  cwd?: string;
}

export interface DetectDeps {
  which?(command: string): Promise<string | undefined>;
  exec?(command: string, args: string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
}

export interface DetectedEnvironment {
  nodeVersion: string;
  nodeOk: boolean;
  idb?: string;
  adb?: string;
  iosUdid?: string;
}

const PLATFORMS = ["fixture", "ios", "android", "web"] as const;
export type InitPlatform = (typeof PLATFORMS)[number];

const STILL_NEEDED = ["TYPESAFE_API_KEY"] as const;

const DEFAULT_APP = {
  bundleId: "com.example.app",
  package: "com.example.app",
  displayName: "Example App",
};

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".convoy", "coverage"]);

const BUILTIN_ENV = `# Secrets — fill these; never commit real values
TYPESAFE_API_KEY=
# Optional TypeSafe overrides (EU or another region; default is US)
TYPESAFE_BASE_URL=https://api.typesafe.ai/v1
TYPESAFE_MODEL=jev-latest

# Driver: fixture | ios | android | web
CONVOY_PLATFORM=fixture

# Optional iOS device overrides (machine-local; do not commit UDIDs)
CONVOY_IOS_UDID=
CONVOY_IOS_BUNDLE_ID=com.example.app
CONVOY_IOS_VERSION=
CONVOY_IOS_APP=

# Optional Android device overrides (machine-local)
CONVOY_ANDROID_SERIAL=
CONVOY_ANDROID_PACKAGE=com.example.app
CONVOY_ANDROID_APK=

# Optional web overrides
CONVOY_WEB_BASE_URL=http://localhost:3000

# How long tap/type wait for the next screen (ms). Raise if login APIs are slow.
CONVOY_ACTION_TIMEOUT_MS=20000

# Print each Jev question + answer. Off unless set to 1.
# CONVOY_DEBUG_JEV=1

# Application secrets — add any private keys your tests need (tokens, credentials).
# YAML interpolates \${NAME}. TypeScript reads process.env.NAME. Never commit real values.
`;

function sampleE2eSource(packageName: string): string {
  return `import { e2e } from ${JSON.stringify(packageName)};

// Copy examples/auth/signin.e2e.ts for a real sign-in flow.
e2e("sample", async (t) => {
  await t.see("the sign in button");
  await t.tap("the sign in button");
});
`;
}

export function isInitPlatform(value: string): value is InitPlatform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Best-effort tool / simulator detection. All failures are skipped. */
export async function detectEnvironment(_cwd: string, deps: DetectDeps = {}): Promise<DetectedEnvironment> {
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  const whichFn = deps.which ?? which;
  const execFn = deps.exec ?? exec;

  const detected: DetectedEnvironment = {
    nodeVersion,
    nodeOk: nodeMajor >= 20,
  };

  try {
    const idb = await whichFn("idb");
    if (idb) detected.idb = idb;
  } catch {
    // skip
  }

  try {
    const adb = await whichFn("adb");
    if (adb) detected.adb = adb;
  } catch {
    // skip
  }

  try {
    const result = await execFn("xcrun", ["simctl", "list", "devices", "available", "-j"], { timeoutMs: 8_000 });
    if (result.code === 0 && result.stdout.trim()) {
      const udid = parseBootedUdid(result.stdout);
      if (udid) detected.iosUdid = udid;
    }
  } catch {
    // skip
  }

  return detected;
}

function parseBootedUdid(json: string): string | undefined {
  try {
    const parsed = JSON.parse(json) as {
      devices?: Record<string, Array<{ udid?: string; state?: string }>>;
    };
    for (const devices of Object.values(parsed.devices ?? {})) {
      const booted = devices.find((d) => d.state === "Booted" && d.udid);
      if (booted?.udid) return booted.udid;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Implemented by the init agent. Non-interactive when `yes` or `platform` is set. */
export async function initCommand(opts: InitOptions, deps: DetectDeps = {}): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());

  const writable = await ensureWritableDir(cwd);
  if (!writable) {
    console.error(pc.red(`init: cannot write to ${cwd}`));
    return 1;
  }

  const resolved = await resolvePlatform(opts);
  if (!resolved.ok) {
    console.error(pc.red(resolved.message));
    return 1;
  }
  const platform = resolved.platform;

  const detected = await detectEnvironment(cwd, deps);
  const app = await detectAppIdentity(cwd);

  const configPath = path.join(cwd, "convoy.config.json");
  const envPath = path.join(cwd, ".env");
  const samplePath = path.join(cwd, "tests", "sample.e2e.ts");

  const notes: string[] = [];

  try {
    const configExisted = existsSync(configPath);
    if (configExisted && !opts.yes) {
      notes.push(`${pc.yellow("kept")}   convoy.config.json`);
    } else {
      await writeFile(configPath, `${JSON.stringify(buildConfigFile(platform, app), null, 2)}\n`, "utf8");
      notes.push(`${pc.green("wrote")}  convoy.config.json`);
    }

    const envExisted = existsSync(envPath);
    if (envExisted) {
      notes.push(`${pc.yellow("kept")}   .env          ${pc.dim("(existing file kept)")}`);
      if (detected.iosUdid) {
        notes.push(pc.dim(`        suggestion: set CONVOY_IOS_UDID=${detected.iosUdid}`));
      }
    } else {
      let envText = await loadEnvTemplate(cwd);
      envText = setEnvValue(envText, "CONVOY_PLATFORM", platform);
      if (detected.iosUdid) {
        envText = setEnvValue(envText, "CONVOY_IOS_UDID", detected.iosUdid);
      }
      await writeFile(envPath, envText.endsWith("\n") ? envText : `${envText}\n`, "utf8");
      notes.push(`${pc.green("wrote")}  .env          ${pc.dim("(from example)")}`);
    }

    if (await hasE2eTests(cwd)) {
      notes.push(`${pc.yellow("kept")}   sample test   ${pc.dim("(existing e2e files)")}`);
    } else {
      await mkdir(path.dirname(samplePath), { recursive: true });
      const pkgName = readPackageJson(thisPackageRoot(import.meta.url)).name;
      await writeFile(samplePath, sampleE2eSource(pkgName), "utf8");
      notes.push(`${pc.green("wrote")}  tests/sample.e2e.ts`);
    }
  } catch {
    console.error(pc.red(`init: cannot write to ${cwd}`));
    return 1;
  }

  console.log("");
  for (const line of notes) console.log(line);

  if (detected.iosUdid && platform === "ios") {
    console.log(pc.dim(`        booted simulator detected (UDID is machine-local; not written to convoy.config.json)`));
  }

  const envText = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const needed = blankEnvKeys(envText, STILL_NEEDED);
  console.log("");
  if (needed.length > 0) {
    console.log(pc.bold("still needed in .env"));
    for (const key of needed) console.log(`  ${pc.cyan(key)}`);
    console.log("");
  }

  console.log(`${pc.dim("then:")}  convoy doctor && convoy run`);
  console.log(pc.dim("      add application secrets to .env as ${NAME} (YAML) or process.env.NAME (TypeScript)"));
  return 0;
}

async function resolvePlatform(opts: InitOptions): Promise<
  { ok: true; platform: InitPlatform } | { ok: false; message: string }
> {
  const interactive = !opts.yes && !opts.platform;
  let raw = opts.platform?.trim() ?? "";

  if (interactive) {
    raw = await askPlatform();
  } else if (!raw) {
    raw = "fixture";
  }

  const platform = raw.toLowerCase();
  if (!isInitPlatform(platform)) {
    return { ok: false, message: `invalid --platform ${raw}. Use fixture | ios | android | web` };
  }
  return { ok: true, platform };
}

async function askPlatform(): Promise<string> {
  if (!process.stdin.isTTY) return "fixture";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("platform (fixture/ios/android/web) [fixture]: ")).trim();
    return answer || "fixture";
  } finally {
    rl.close();
  }
}

function buildConfigFile(
  platform: InitPlatform,
  app: { bundleId: string; package: string; displayName: string },
): Record<string, unknown> {
  return {
    platform,
    app: {
      bundleId: app.bundleId,
      package: app.package,
      displayName: app.displayName,
    },
    ios: {
      bundleId: app.bundleId,
      build: { when: "missing" },
    },
    android: {
      package: app.package,
    },
    tracesDir: ".convoy/runs",
    reset: "relaunch",
    lifecycle: {
      install: true,
      launch: true,
      resetBetweenTests: true,
    },
  };
}

async function detectAppIdentity(
  cwd: string,
): Promise<{ bundleId: string; package: string; displayName: string }> {
  const app = { ...DEFAULT_APP };
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; displayName?: string };
    if (typeof pkg.displayName === "string" && pkg.displayName.trim()) {
      app.displayName = pkg.displayName.trim();
    } else if (typeof pkg.name === "string" && pkg.name.trim() && !pkg.name.startsWith("convoy")) {
      const leaf = pkg.name.split("/").pop() ?? pkg.name;
      if (leaf && leaf !== "convoy") {
        app.displayName = leaf
          .split(/[-_]/)
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
    }
  } catch {
    // default app identity
  }
  return app;
}

async function loadEnvTemplate(cwd: string): Promise<string> {
  const cwdExample = path.join(cwd, ".env.example");
  if (existsSync(cwdExample)) {
    return readFile(cwdExample, "utf8");
  }
  const pkgExample = path.join(packageRoot(), ".env.example");
  if (existsSync(pkgExample)) {
    return readFile(pkgExample, "utf8");
  }
  return BUILTIN_ENV;
}

function packageRoot(): string {
  return thisPackageRoot(import.meta.url);
}

function setEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\s*$/, "")}\n${line}\n`;
}

function blankEnvKeys(envText: string, keys: readonly string[]): string[] {
  return keys.filter((key) => {
    const match = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
    return !match || match[1].trim() === "";
  });
}

async function hasE2eTests(cwd: string): Promise<boolean> {
  const walk = async (dir: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (await walk(full)) return true;
      } else if (entry.isFile() && (entry.name.endsWith(".e2e.ts") || entry.name.endsWith(".e2e.yaml"))) {
        return true;
      }
    }
    return false;
  };
  return walk(cwd);
}

async function ensureWritableDir(cwd: string): Promise<boolean> {
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) return false;
    await access(cwd, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
