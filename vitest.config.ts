import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "convoy-e2e": path.resolve("src/index.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    reporters: ["verbose"],
    testTimeout: 15_000,
    env: {
      CONVOY_PLATFORM: "fixture",
      CONVOY_JEV_MODE: "heuristic",
      CONVOY_HEADED: "false",
      CONVOY_DEBUG_JEV: "0",
    },
  },
});
