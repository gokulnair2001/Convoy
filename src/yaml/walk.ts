import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".convoy", ".git"]);

export function yamlRoot(): string {
  return path.resolve(process.env.CONVOY_ROOT || process.cwd());
}

export function isE2eYaml(file: string): boolean {
  return /\.e2e\.ya?ml$/.test(file);
}

export function isE2eTs(file: string): boolean {
  return file.endsWith(".e2e.ts");
}

export interface E2eFiles {
  ts: string[];
  yaml: string[];
}

/**
 * Recursively find `*.e2e.ts` / `*.e2e.yaml` / `*.e2e.yml` under `root`.
 * Node 20-safe: no `fs.globSync`.
 */
export function findE2eFiles(root: string): E2eFiles {
  const ts: string[] = [];
  const yaml: string[] = [];
  walk(path.resolve(root), ts, yaml);
  ts.sort();
  yaml.sort();
  return { ts, yaml };
}

/** Recursively find `*.e2e.yaml` / `*.e2e.yml` under `root`. */
export function findYamlTestFiles(root: string): string[] {
  return findE2eFiles(root).yaml;
}

function walk(dir: string, ts: string[], yaml: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, ts, yaml);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isE2eTs(entry.name)) ts.push(full);
    else if (isE2eYaml(entry.name)) yaml.push(full);
  }
}
