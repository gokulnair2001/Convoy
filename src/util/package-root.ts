import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageJson {
  name: string;
  version: string;
}

/** Walk up from a file or directory until a package.json is found. */
export function findPackageRoot(fromFileOrDir: string): string {
  let dir = path.resolve(fromFileOrDir);
  try {
    if (statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`package.json not found from ${fromFileOrDir}`);
}

export function readPackageJson(root: string): PackageJson {
  const raw = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  return {
    name: raw.name ?? "convoy",
    version: raw.version ?? "0.0.0",
  };
}

export function thisPackageRoot(fromMetaUrl: string): string {
  return findPackageRoot(fileURLToPath(fromMetaUrl));
}
