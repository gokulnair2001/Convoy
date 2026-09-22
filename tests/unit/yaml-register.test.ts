import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/runner/e2e.js", () => ({
  e2e: vi.fn(),
}));

import { e2e } from "../../src/runner/e2e.js";
import { loadYamlTests } from "../../src/yaml/parse.js";
import { registerYamlTests } from "../../src/yaml/register.js";
import { findYamlTestFiles } from "../../src/yaml/walk.js";

const tmpDirs: string[] = [];

afterEach(() => {
  vi.mocked(e2e).mockClear();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-yaml-"));
  tmpDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, body: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

describe("findYamlTestFiles", () => {
  it("finds .e2e.yaml and .e2e.yml and skips node_modules, dist, and .convoy", () => {
    const root = tmpRoot();
    const keepYaml = write(root, "examples/auth/signin.e2e.yaml", "name: yaml\nsteps:\n  - tap: A\n");
    const keepYml = write(root, "more/flow.e2e.yml", "name: yml\nsteps:\n  - tap: B\n");
    write(root, "node_modules/pkg/skip.e2e.yaml", "name: skip-nm\nsteps:\n  - tap: X\n");
    write(root, "dist/skip.e2e.yaml", "name: skip-dist\nsteps:\n  - tap: X\n");
    write(root, ".convoy/skip.e2e.yaml", "name: skip-convoy\nsteps:\n  - tap: X\n");
    write(root, "notes.yaml", "name: not-e2e\n");

    expect(findYamlTestFiles(root)).toEqual([keepYaml, keepYml].sort());
  });
});

describe("loadYamlTests", () => {
  it("parses every discovered yaml file", () => {
    const root = tmpRoot();
    write(root, "a.e2e.yaml", "name: first\nsteps:\n  - tap: One\n");
    write(root, "nested/b.e2e.yml", "name: second\nsteps:\n  - see: Two\n");

    const loaded = loadYamlTests(root);
    expect(loaded.map((doc) => doc.name).sort()).toEqual(["first", "second"]);
  });
});

describe("registerYamlTests", () => {
  it("registers each file once even when called twice", () => {
    const root = tmpRoot();
    write(root, "only.e2e.yaml", "name: only yaml\nplatforms: [web]\ntags: [smoke]\nsteps:\n  - tap: Go\n");

    registerYamlTests(root);
    registerYamlTests(root);

    expect(e2e).toHaveBeenCalledTimes(1);
    expect(e2e).toHaveBeenCalledWith(
      "only yaml",
      {
        platforms: ["web"],
        tags: ["smoke"],
        fixture: undefined,
        start: undefined,
        file: path.join(root, "only.e2e.yaml"),
      },
      expect.any(Function),
    );
  });

  it("passes start through to e2e opts", () => {
    const root = tmpRoot();
    write(root, "attach.e2e.yaml", "name: stay here\nstart: attach\nsteps:\n  - see: the home screen\n");

    registerYamlTests(root);

    expect(e2e).toHaveBeenCalledWith(
      "stay here",
      {
        platforms: undefined,
        tags: undefined,
        fixture: undefined,
        start: "attach",
        file: path.join(root, "attach.e2e.yaml"),
      },
      expect.any(Function),
    );
  });
});
