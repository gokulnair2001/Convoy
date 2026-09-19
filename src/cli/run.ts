import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ConvoyConfig } from "../core/config.js";
import { loadConfig } from "../core/load-config.js";
import { prepareEnvironment } from "../lifecycle/prepare.js";
import { Reporter, type RunBanner } from "../runner/reporter.js";
import { thisPackageRoot, readPackageJson } from "../util/package-root.js";
import { encodeYamlFilesEnv, resolveRunTargets, vitestFileArgs } from "../yaml/targets.js";
import { ensureYamlHost, removeYamlHost } from "./yaml-host.js";

export interface RunOptions {
  files?: string[];
  tag?: string;
  headless?: boolean;
  headed?: boolean;
  shard?: string;
  step?: boolean;
  slowMo?: number;
  platform?: string;
  junit?: boolean;
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const config = await loadConfig();
  const headed = opts.headed ?? (!opts.headless && config.headed);
  if (opts.platform) config.platform = opts.platform as ConvoyConfig["platform"];
  config.headed = headed;
  const reporter = new Reporter(!headed);
  reporter.banner(bannerFromConfig(config, headed));

  const cwd = process.cwd();
  const targets = resolveRunTargets(opts.files ?? [], cwd);
  if (!targets.all && targets.ts.length === 0 && targets.yaml.length === 0) {
    const asked = (opts.files ?? []).join(", ") || "the given paths";
    reporter.fail("run", "files", `no *.e2e.ts or *.e2e.yaml files under ${asked}`);
    return 1;
  }

  try {
    await prepareEnvironment(config, reporter);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.fail("prepare", "lifecycle", message);
    return 1;
  }

  const yamlOnly = !targets.all && targets.yaml.length > 0 && targets.ts.length === 0;
  const yamlHost = yamlOnly ? ensureYamlHost(cwd) : "";
  if (!yamlOnly) removeYamlHost(cwd);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CONVOY_PLATFORM: opts.platform ?? process.env.CONVOY_PLATFORM ?? config.platform,
    CONVOY_HEADED: headed ? "true" : "false",
    CONVOY_HEADLESS: headed ? "0" : "1",
    CONVOY_STEP: opts.step ? "true" : "false",
    CONVOY_SLOW_MO: String(opts.slowMo ?? config.slowMoMs ?? 0),
    CONVOY_PREPARED: "1",
    CONVOY_E2E: "1",
  };
  if (opts.tag) env.CONVOY_TAG = opts.tag;
  if (!targets.all) env.CONVOY_YAML_FILES = encodeYamlFilesEnv(targets.yaml);

  const pkgRoot = thisPackageRoot(import.meta.url);
  const args = [
    "run",
    "--config",
    resolveE2eConfig(pkgRoot),
    ...vitestFileArgs(targets, yamlHost),
  ];
  if (headed) {
    args.push("--maxWorkers", "1");
    args.push("--fileParallelism", "false");
  } else if (config.platform === "ios" || config.platform === "android") {
    args.push("--maxWorkers", "1");
    args.push("--fileParallelism", "false");
  }
  if (opts.shard) args.push("--shard", opts.shard);
  if (opts.junit) {
    args.push("--reporter=default", "--reporter=junit", "--outputFile.junit=reports/junit.xml");
  }

  const started = Date.now();
  const code = await spawnInherit(process.execPath, [resolveVitestBin(), ...args], { cwd, env });
  reporter.summary({
    passed: code === 0 ? 1 : 0,
    failed: code === 0 ? 0 : 1,
    durationMs: Date.now() - started,
    tracesDir: config.tracesDir,
  });
  return code;
}

export function bannerFromConfig(config: ConvoyConfig, headed: boolean): RunBanner {
  return {
    version: readPackageJson(thisPackageRoot(import.meta.url)).version,
    platform: config.platform,
    device: deviceLabel(config),
    app: appLabel(config),
    jev: jevLabel(config),
    tracesDir: config.tracesDir,
    headed,
  };
}

export function resolveE2eConfig(pkgRoot: string): string {
  const fromSrc = path.join(pkgRoot, "src/vitest/e2e.config.ts");
  if (existsSync(fromSrc)) return fromSrc;
  const fromDist = path.join(pkgRoot, "dist/vitest/e2e.config.js");
  if (existsSync(fromDist)) return fromDist;
  throw new Error("Convoy e2e Vitest config missing from the installed package");
}

export function resolveVitestBin(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("vitest/vitest.mjs");
  } catch {
    throw new Error("vitest is not installed. Add it with: npm install -D vitest");
  }
}

function deviceLabel(config: ConvoyConfig): string {
  if (config.platform === "ios") {
    return config.ios.udid ? `iPhone (${config.ios.udid})` : "iPhone";
  }
  if (config.platform === "android") {
    return config.android.serial ?? "unset";
  }
  if (config.platform === "web") {
    return config.web.baseUrl;
  }
  return "fixture";
}

function appLabel(config: ConvoyConfig): string {
  const id = config.platform === "android" ? config.app.package : config.app.bundleId;
  return `${config.app.displayName}  ${id}`;
}

function jevLabel(config: ConvoyConfig): string {
  const base = `${config.jev.mode} · ${config.jev.model}`;
  return config.jev.debug ? `${base} · debug` : base;
}

function spawnInherit(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
