import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findPackageRoot, readPackageJson } from "../../src/util/package-root.js";
import { resolveE2eConfig, resolveVitestBin } from "../../src/cli/run.js";
import { ensureYamlHost, removeYamlHost, yamlHostPath } from "../../src/cli/yaml-host.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "convoy-pkg-"));
  dirs.push(dir);
  return dir;
}

describe("findPackageRoot", () => {
  it("walks up from dist/cli to the folder with package.json", async () => {
    const root = await tmpDir();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.2.3" }));
    const nested = path.join(root, "dist", "cli");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "index.js"), "");

    expect(findPackageRoot(path.join(nested, "index.js"))).toBe(root);
    expect(readPackageJson(root)).toEqual({ name: "demo", version: "1.2.3" });
  });
});

describe("resolveE2eConfig", () => {
  it("prefers src in this repo and falls back to dist", async () => {
    const repo = findPackageRoot(fileURLToPath(import.meta.url));
    expect(resolveE2eConfig(repo)).toContain(`${path.sep}src${path.sep}vitest${path.sep}e2e.config.ts`);

    const fake = await tmpDir();
    mkdirSync(path.join(fake, "dist", "vitest"), { recursive: true });
    writeFileSync(path.join(fake, "dist", "vitest", "e2e.config.js"), "export default {}\n");
    expect(resolveE2eConfig(fake)).toBe(path.join(fake, "dist", "vitest", "e2e.config.js"));
  });

  it("resolves the vitest CLI next to this package", () => {
    expect(resolveVitestBin()).toMatch(/vitest\.mjs$/);
  });
});

describe("yaml host", () => {
  it("writes and removes the yaml-only host under .convoy", async () => {
    const cwd = await tmpDir();
    const host = ensureYamlHost(cwd);
    expect(host).toBe(yamlHostPath(cwd));
    expect(host.endsWith(path.join(".convoy", "yaml-host.e2e.ts"))).toBe(true);
    removeYamlHost(cwd);
    expect(() => removeYamlHost(cwd)).not.toThrow();
  });
});
