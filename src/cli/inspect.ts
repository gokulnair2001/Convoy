import { writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import type { ConvoyConfig } from "../core/config.js";
import type { Driver } from "../core/driver.js";
import { loadConfig } from "../core/load-config.js";
import { toPublicElement } from "../core/element.js";
import { createDriver } from "../drivers/create.js";
import { AndroidDriver } from "../drivers/android.js";
import { IosDriver } from "../drivers/ios.js";
import { WebDriver } from "../drivers/web.js";
import { prepareEnvironment } from "../lifecycle/prepare.js";
import { Reporter } from "../runner/reporter.js";

async function prepareOrThrow(config: ConvoyConfig): Promise<void> {
  const reporter = new Reporter(false);
  try {
    await prepareEnvironment(config, reporter);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.fail("prepare", "lifecycle", message);
    throw err;
  }
}

export async function inspectCommand(): Promise<void> {
  const config = await loadConfig();
  await prepareOrThrow(config);
  const driver = await createDriver(config);
  try {
    const elements = await driver.snapshot();
    if (elements.length === 0) {
      console.log("no labelled on-screen elements");
      return;
    }
    const idW = Math.max(2, ...elements.map((e) => e.id.length));
    const roleW = Math.max(4, ...elements.map((e) => e.role.length));
    console.log(pc.bold(`${elements.length} elements  (${config.platform})`));
    console.log("");
    for (const el of elements) {
      const value = el.value ? pc.dim(`  value=${JSON.stringify(el.value)}`) : "";
      const enabled = el.enabled ? "enabled " : pc.red("disabled");
      const bounds = el.bounds.map((n) => n.toFixed(2)).join(", ");
      console.log(
        `${el.id.padEnd(idW)}  ${el.role.padEnd(roleW)}  ${JSON.stringify(el.name).padEnd(28)}  ${enabled}  (${bounds})${value}`,
      );
    }
  } finally {
    await driver.close();
  }
}

export async function captureCommand(opts: { name?: string; out?: string }): Promise<void> {
  const config = await loadConfig();
  await prepareOrThrow(config);
  const driver = await createDriver(config);
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = opts.name ?? `capture-${stamp}`;
    const dir = opts.out ?? path.resolve(".convoy/captures");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });

    const elements = await driver.snapshot();
    const screenshot = await driver.screenshot();
    const raw = await rawDump(driver);

    const payload = {
      capturedAt: new Date().toISOString(),
      platform: config.platform,
      emulatePlatform: config.platform === "fixture" ? config.fixture.emulatePlatform : config.platform,
      elements: elements.map(toPublicElement),
      raw,
    };
    const jsonPath = path.join(dir, `${name}.json`);
    const pngPath = path.join(dir, `${name}.png`);
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(pngPath, screenshot);
    console.log(`wrote ${jsonPath}`);
    console.log(`wrote ${pngPath}`);
    console.log(`${elements.length} elements`);
  } finally {
    await driver.close();
  }
}

async function rawDump(driver: Driver): Promise<unknown> {
  if (driver instanceof IosDriver) return driver.rawDump();
  if (driver instanceof AndroidDriver) return driver.rawDump();
  if (driver instanceof WebDriver) return driver.rawDump();
  return undefined;
}
