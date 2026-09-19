import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import type { ConvoyConfig } from "../core/config.js";
import { loadConfig } from "../core/load-config.js";
import { which } from "../util/exec.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export async function doctorCommand(): Promise<number> {
  const checks = await runDoctor();
  for (const check of checks) {
    const mark = check.ok ? pc.green("✓") : check.required ? pc.red("✗") : pc.yellow("⚠");
    console.log(`${mark} ${check.name.padEnd(22)} ${pc.dim(check.detail)}`);
  }
  const config = await loadConfig().catch(() => undefined);
  printResolved(config);
  const failed = checks.filter((c) => c.required && !c.ok);
  console.log("");
  if (failed.length > 0) {
    console.log(pc.red(`doctor: failed (${failed.length} required check${failed.length === 1 ? "" : "s"})`));
    return 1;
  }
  const warnings = checks.filter((c) => !c.required && !c.ok).length;
  console.log(pc.green(`doctor: ok`) + (warnings ? pc.dim(`  (${warnings} optional warning${warnings === 1 ? "" : "s"})`) : ""));
  return 0;
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const node = process.versions.node;
  const nodeMajor = Number(node.split(".")[0]);
  checks.push({
    name: "Node.js",
    ok: nodeMajor >= 20,
    required: true,
    detail: nodeMajor >= 20 ? node : `${node} (need >= 20)`,
  });

  const pkgPath = path.resolve("package.json");
  let pkgName = "unknown";
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { name?: string };
    pkgName = pkg.name ?? "unknown";
    checks.push({ name: "package", ok: true, required: true, detail: pkgName });
  } catch {
    checks.push({ name: "package", ok: false, required: true, detail: "package.json unreadable" });
  }

  const config = await loadConfig().catch(() => undefined);
  checks.push({
    name: "config",
    ok: Boolean(config),
    required: true,
    detail: config ? `platform=${config.platform}` : "failed to load convoy.config.json",
  });
  checks.push({
    name: "platform",
    ok: Boolean(config),
    required: false,
    detail: config?.platform ?? "unknown",
  });

  const fixturePath = config?.fixture.path ?? "tests/fixtures/signin.json";
  const fixtureOk = existsSync(path.resolve(fixturePath));
  checks.push({
    name: "fixture",
    ok: fixtureOk,
    required: false,
    detail: fixtureOk ? fixturePath : `${fixturePath} not found`,
  });

  const apiKey = process.env.TYPESAFE_API_KEY ?? config?.jev.apiKey;
  checks.push({
    name: "TYPESAFE_API_KEY",
    ok: Boolean(apiKey),
    required: false,
    detail: apiKey
      ? "set"
      : "not set (live Jev disabled; fixture + heuristic still work)",
  });

  const idb = await which("idb");
  checks.push({
    name: "idb",
    ok: Boolean(idb),
    required: false,
    detail: idb ?? "not found (iOS driver unavailable)",
  });

  const adb = await which("adb");
  checks.push({
    name: "adb",
    ok: Boolean(adb),
    required: false,
    detail: adb ?? "not found (Android driver unavailable)",
  });

  let playwright = false;
  try {
    await import("playwright");
    playwright = true;
  } catch {
    playwright = false;
  }
  checks.push({
    name: "playwright",
    ok: playwright,
    required: false,
    detail: playwright ? "installed" : "not installed (web driver unavailable)",
  });

  return checks;
}

function printResolved(config: ConvoyConfig | undefined): void {
  console.log("");
  console.log(pc.bold("resolved"));
  if (!config) {
    console.log(pc.dim("  (config unavailable)"));
    return;
  }
  const bundle = config.platform === "android" ? config.app.package : config.app.bundleId;
  const deviceId =
    config.platform === "ios"
      ? (config.ios.udid ?? "unset")
      : config.platform === "android"
        ? (config.android.serial ?? "unset")
        : config.platform === "web"
          ? config.web.baseUrl
          : "unset";
  const binary =
    config.platform === "ios"
      ? pathStatus(config.ios.appPath)
      : config.platform === "android"
        ? pathStatus(config.android.apkPath)
        : "n/a";
  const apiKey = process.env.TYPESAFE_API_KEY ?? config.jev.apiKey;
  console.log(`  ${"platform".padEnd(16)} ${config.platform}`);
  console.log(`  ${"bundle/package".padEnd(16)} ${bundle}`);
  console.log(`  ${"udid/serial".padEnd(16)} ${deviceId}`);
  console.log(`  ${"appPath/apkPath".padEnd(16)} ${binary}`);
  console.log(`  ${"jev".padEnd(16)} ${config.jev.mode}`);
  console.log(`  ${"TYPESAFE_API_KEY".padEnd(16)} ${apiKey ? "set" : "not set"}`);
}

function pathStatus(value: string | undefined): string {
  if (!value) return "unset";
  return existsSync(path.resolve(value)) ? `${value} (exists)` : `${value} (missing)`;
}
