import fs from "node:fs";
import path from "node:path";
import { findE2eFiles, isE2eTs, isE2eYaml } from "./walk.js";

export interface RunTargets {
  /** No file / folder args — discover every e2e file under the project. */
  all: boolean;
  ts: string[];
  yaml: string[];
}

const ARG_NOISE = new Set(["vitest", "node", "npx", "tsx", "run"]);

/** True when this argv token is a vitest/node invocation artifact, not an author path. */
export function isRunArgNoise(arg: string): boolean {
  if (!arg || arg.startsWith("-")) return true;
  const base = path.basename(arg);
  if (ARG_NOISE.has(base)) return true;
  if (arg.includes("vitest.e2e.config")) return true;
  if (arg.includes("vitest/e2e.config")) return true;
  if (arg.includes("yaml-host.e2e.ts")) return true;
  if (arg.includes("vitest-entry")) return true;
  return false;
}

/**
 * Pull folders and `*.e2e.ts` / `*.e2e.yaml` paths out of a raw argv
 * (vitest's process.argv). Other files are ignored so unit-test paths
 * do not look like an empty selection.
 */
export function userTestPaths(args: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (isRunArgNoise(arg)) continue;
    const resolved = path.resolve(cwd, arg);
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        out.push(arg);
        continue;
      }
      if (stat.isFile() && (isE2eYaml(resolved) || isE2eTs(resolved))) out.push(arg);
    } catch {
      if (isE2eYaml(arg) || isE2eTs(arg)) out.push(arg);
    }
  }
  return out;
}

/**
 * Expand CLI paths (files and folders) into the e2e tests they contain.
 * Folders are walked recursively (skipping node_modules, dist, .convoy, .git).
 * `args` should already be author paths (commander files, or `userTestPaths`).
 */
export function resolveRunTargets(args: string[], cwd: string): RunTargets {
  const user = (args ?? []).map((arg) => arg.trim()).filter(Boolean);
  if (user.length === 0) return { all: true, ts: [], yaml: [] };

  const ts = new Set<string>();
  const yaml = new Set<string>();

  for (const arg of user) {
    const resolved = path.resolve(cwd, arg);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(resolved);
    } catch {
      if (isE2eYaml(arg)) yaml.add(resolved);
      else if (isE2eTs(arg)) ts.add(resolved);
      continue;
    }
    if (stat.isDirectory()) {
      const found = findE2eFiles(resolved);
      for (const file of found.ts) ts.add(file);
      for (const file of found.yaml) yaml.add(file);
      continue;
    }
    if (stat.isFile()) {
      if (isE2eYaml(resolved)) yaml.add(resolved);
      else if (isE2eTs(resolved)) ts.add(resolved);
    }
  }

  return { all: false, ts: [...ts].sort(), yaml: [...yaml].sort() };
}

/**
 * File filters to pass to Vitest.
 * YAML tests are registered in setup, so yaml-only runs need the entry file as a host.
 */
export function vitestFileArgs(targets: RunTargets, yamlEntry: string): string[] {
  if (targets.all) return [];
  if (targets.yaml.length > 0 && targets.ts.length === 0) return [yamlEntry];
  return targets.ts;
}

export function encodeYamlFilesEnv(files: string[]): string {
  return JSON.stringify(files);
}

export function decodeYamlFilesEnv(raw: string): string[] {
  if (raw === "") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("CONVOY_YAML_FILES must be a JSON string array");
  }
  return parsed;
}
