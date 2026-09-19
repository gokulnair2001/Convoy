import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  applyEnv,
  defaultConfig,
  mergeConfig,
  type ConvoyConfig,
  type ConvoyConfigFile,
} from "./config.js";

loadDotenv();

const CONFIG_NAMES = ["convoy.config.json", "convoy.config.js", "convoy.config.ts"];

export async function loadConfig(cwd = process.cwd()): Promise<ConvoyConfig> {
  let config = defaultConfig();
  const file = await readConfigFile(cwd);
  if (file) config = mergeConfig(config, file);
  return applyEnv(config);
}

async function readConfigFile(cwd: string): Promise<ConvoyConfigFile | undefined> {
  for (const name of CONFIG_NAMES) {
    const full = path.resolve(cwd, name);
    if (!existsSync(full)) continue;
    if (name.endsWith(".json")) {
      const raw = await readFile(full, "utf8");
      return JSON.parse(raw) as ConvoyConfigFile;
    }
    const mod = (await import(pathToFileURL(full).href)) as { default?: ConvoyConfigFile };
    return mod.default ?? (mod as ConvoyConfigFile);
  }
  return undefined;
}
