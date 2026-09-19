import fs from "node:fs";
import path from "node:path";
import { e2e } from "../runner/e2e.js";
import { executeSteps } from "./execute.js";
import { parseYamlDocument } from "./parse.js";
import { decodeYamlFilesEnv, resolveRunTargets, userTestPaths } from "./targets.js";
import { findYamlTestFiles, yamlRoot } from "./walk.js";

const registeredFiles = new Set<string>();

export interface SelectYamlOptions {
  args?: string[];
  /** `null` ignores process.env (tests). Unset reads `CONVOY_YAML_FILES`. */
  yamlFilesEnv?: string | null;
  cwd?: string;
}

/**
 * `convoy run some.e2e.ts` should not also pick up every YAML file via setupFiles.
 * No file args → register all YAML under root.
 * Explicit YAML paths → only those.
 * A folder → YAML under that folder (nested), not the rest of the project.
 */
export function selectYamlTestFiles(root: string, options: SelectYamlOptions = {}): string[] {
  const yamlFilesEnv =
    options.yamlFilesEnv === null
      ? undefined
      : (options.yamlFilesEnv ?? process.env.CONVOY_YAML_FILES);
  if (yamlFilesEnv !== undefined) return decodeYamlFilesEnv(yamlFilesEnv);

  const cwd = options.cwd ?? process.cwd();
  const args = options.args ?? userTestPaths(process.argv, cwd);
  const targets = resolveRunTargets(args, cwd);
  if (targets.all) return findYamlTestFiles(root);
  return targets.yaml;
}

export function registerYamlTests(root: string = yamlRoot()): void {
  for (const file of selectYamlTestFiles(root)) {
    const abs = path.resolve(file);
    if (registeredFiles.has(abs)) continue;
    registeredFiles.add(abs);
    const doc = parseYamlDocument(fs.readFileSync(abs, "utf8"), abs);
    e2e(doc.name, { platforms: doc.platforms, tags: doc.tags, fixture: doc.fixture, file: abs }, async (t) => {
      await executeSteps(t, doc.steps, { file: abs });
    });
  }
}

/** True when this module is loaded as the e2e vitest setup/entry (not unit tests). */
function shouldAutoRegister(): boolean {
  return (
    process.env.CONVOY_E2E === "1" ||
    process.argv.some((arg) => arg.includes("vitest.e2e.config") || arg.includes("vitest/e2e.config"))
  );
}

if (shouldAutoRegister()) {
  registerYamlTests();
}
