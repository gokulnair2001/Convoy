import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  encodeYamlFilesEnv,
  resolveRunTargets,
  userTestPaths,
  vitestFileArgs,
} from "../../src/yaml/targets.js";
import { findE2eFiles } from "../../src/yaml/walk.js";
import { selectYamlTestFiles } from "../../src/yaml/register.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-targets-"));
  tmpDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, body = "name: t\nsteps:\n  - tap: A\n"): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

describe("findE2eFiles", () => {
  it("finds nested ts and yaml and skips node_modules", () => {
    const root = tmpRoot();
    const ts = write(root, "suite/nested/flow.e2e.ts", "export {}\n");
    const yaml = write(root, "suite/nested/flow.e2e.yaml");
    write(root, "node_modules/pkg/skip.e2e.ts", "export {}\n");
    write(root, "suite/notes.yaml", "name: not-e2e\n");

    expect(findE2eFiles(path.join(root, "suite"))).toEqual({ ts: [ts], yaml: [yaml] });
  });
});

describe("resolveRunTargets", () => {
  it("discovers everything when no args are given", () => {
    expect(resolveRunTargets([], "/tmp")).toEqual({ all: true, ts: [], yaml: [] });
  });

  it("walks a folder for nested ts and yaml only under that tree", () => {
    const root = tmpRoot();
    const insideTs = write(root, "tests/regression/checkout/pay.e2e.ts", "export {}\n");
    const insideYaml = write(root, "tests/regression/checkout/pay.e2e.yaml");
    write(root, "tests/smoke/login.e2e.yaml");
    write(root, "tests/smoke/login.e2e.ts", "export {}\n");

    const targets = resolveRunTargets(["tests/regression"], root);
    expect(targets.all).toBe(false);
    expect(targets.ts).toEqual([insideTs]);
    expect(targets.yaml).toEqual([insideYaml]);
  });

  it("keeps yaml empty when only a .e2e.ts file is passed", () => {
    const root = tmpRoot();
    const ts = write(root, "tests/login.e2e.ts", "export {}\n");
    write(root, "tests/login.e2e.yaml");

    const targets = resolveRunTargets(["tests/login.e2e.ts"], root);
    expect(targets.ts).toEqual([ts]);
    expect(targets.yaml).toEqual([]);
  });

  it("keeps only the yaml file when that path is passed", () => {
    const root = tmpRoot();
    write(root, "tests/login.e2e.ts", "export {}\n");
    const yaml = write(root, "tests/login.e2e.yaml");
    write(root, "tests/other.e2e.yaml");

    const targets = resolveRunTargets(["tests/login.e2e.yaml"], root);
    expect(targets.ts).toEqual([]);
    expect(targets.yaml).toEqual([yaml]);
  });
});

describe("vitestFileArgs", () => {
  it("passes the yaml host file when the folder has yaml and no ts", () => {
    expect(
      vitestFileArgs({ all: false, ts: [], yaml: ["/tmp/a.e2e.yaml"] }, "/pkg/vitest-entry.ts"),
    ).toEqual(["/pkg/vitest-entry.ts"]);
  });

  it("passes ts files when both kinds exist so yaml rides along in setup", () => {
    expect(
      vitestFileArgs(
        { all: false, ts: ["/tmp/a.e2e.ts"], yaml: ["/tmp/a.e2e.yaml"] },
        "/pkg/vitest-entry.ts",
      ),
    ).toEqual(["/tmp/a.e2e.ts"]);
  });
});

describe("selectYamlTestFiles", () => {
  it("scopes yaml to a folder even when sibling yaml exists", () => {
    const root = tmpRoot();
    const nested = write(root, "tests/regression/deep/flow.e2e.yaml");
    write(root, "tests/smoke/login.e2e.yaml");

    expect(
      selectYamlTestFiles(root, {
        args: [path.join(root, "tests/regression")],
        yamlFilesEnv: null,
        cwd: root,
      }),
    ).toEqual([nested]);
  });

  it("registers no yaml when CONVOY_YAML_FILES is an empty list", () => {
    const root = tmpRoot();
    write(root, "tests/login.e2e.yaml");
    expect(selectYamlTestFiles(root, { yamlFilesEnv: encodeYamlFilesEnv([]) })).toEqual([]);
  });

  it("ignores vitest argv noise so unit tests still discover from root", () => {
    const root = tmpRoot();
    const yaml = write(root, "only.e2e.yaml");
    const argv = ["node", "vitest", "run", "tests/unit/yaml-register.test.ts"];
    expect(userTestPaths(argv, root)).toEqual([]);
    expect(selectYamlTestFiles(root, { args: userTestPaths(argv, root), yamlFilesEnv: null })).toEqual(
      [yaml],
    );
  });

  it("treats a folder in vitest argv as the yaml root", () => {
    const root = tmpRoot();
    const nested = write(root, "tests/regression/flow.e2e.yaml");
    write(root, "tests/smoke/login.e2e.yaml");
    const folder = path.join(root, "tests/regression");
    const argv = ["vitest", "run", "--config", "vitest.e2e.config.ts", folder];
    expect(userTestPaths(argv, root)).toEqual([folder]);
    expect(
      selectYamlTestFiles(root, { args: userTestPaths(argv, root), yamlFilesEnv: null, cwd: root }),
    ).toEqual([nested]);
  });
});
