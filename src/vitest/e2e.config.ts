import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";
import { findPackageRoot, readPackageJson } from "../util/package-root.js";

loadDotenv();

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = findPackageRoot(here);
const pkg = readPackageJson(pkgRoot);
const srcIndex = path.join(pkgRoot, "src/index.ts");
const yamlDir = path.resolve(here, "../yaml");
const register = existsSync(path.join(yamlDir, "register.ts"))
  ? path.join(yamlDir, "register.ts")
  : path.join(yamlDir, "register.js");

/**
 * Consumer-safe e2e config. In this repo, `src/index.ts` exists so we alias
 * the package name to source. After `npm install`, the package resolves normally.
 */
export default defineConfig({
  resolve: existsSync(srcIndex)
    ? { alias: { [pkg.name]: srcIndex } }
    : {},
  test: {
    include: ["**/*.e2e.ts"],
    setupFiles: [register],
    exclude: ["**/node_modules/**", "dist/**"],
    environment: "node",
    reporters: ["verbose"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    sequence: { shuffle: true },
    disableConsoleIntercept: true,
    env: {
      CONVOY_JEV_MODE:
        process.env.CONVOY_JEV_MODE ?? (process.env.TYPESAFE_API_KEY ? "live" : "heuristic"),
      CONVOY_DEBUG_JEV: process.env.CONVOY_DEBUG_JEV ?? "0",
    },
  },
});
