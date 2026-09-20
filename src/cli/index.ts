#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { captureCommand, inspectCommand } from "./inspect.js";
import { doctorCommand } from "./doctor.js";
import { initCommand } from "./init.js";
import { runCommand } from "./run.js";
import { readPackageJson, thisPackageRoot } from "../util/package-root.js";

loadDotenv();

const { version } = readPackageJson(thisPackageRoot(import.meta.url));

const program = new Command();
program.name("convoy").description("Semantic end-to-end agent testing for iOS, Android, and web.").version(version);

program
  .command("run")
  .description("Execute tests")
  .argument("[files...]", "test files, folders, or globs (default: **/*.e2e.ts and **/*.e2e.yaml)")
  .option("--tag <tag>", "only tests with this tag")
  .option("--headless", "statuses only; allow parallel workers")
  .option("--headed", "watch it happen; serial, one device")
  .option("--shard <spec>", "CI shard, e.g. 1/4")
  .option("--step", "pause before each action")
  .option("--slow-mo <ms>", "delay after each action", (v) => Number(v))
  .option("--platform <name>", "fixture | ios | android | web")
  .option("--junit", "write reports/junit.xml")
  .action(async (files: string[], opts) => {
    const code = await runCommand({
      files,
      tag: opts.tag,
      headless: opts.headless,
      headed: opts.headed,
      shard: opts.shard,
      step: opts.step,
      slowMo: opts.slowMo,
      platform: opts.platform,
      junit: opts.junit,
    });
    process.exitCode = code;
  });

program
  .command("inspect")
  .description("Print the element table for the current screen")
  .action(async () => {
    await inspectCommand();
  });

program
  .command("capture")
  .description("Save the current screen as a fixture")
  .option("--name <name>", "fixture name")
  .option("--out <dir>", "output directory")
  .action(async (opts) => {
    await captureCommand(opts);
  });

program
  .command("init")
  .description("Write convoy.config.json, .env, and a sample test")
  .option("--platform <name>", "fixture | ios | android | web")
  .option("--yes", "non-interactive; skip prompts")
  .action(async (opts) => {
    const code = await initCommand({ platform: opts.platform, yes: Boolean(opts.yes) });
    process.exitCode = code;
  });

program
  .command("doctor")
  .description("Verify environment: simulator, idb, app, API key")
  .action(async () => {
    const code = await doctorCommand();
    process.exitCode = code;
  });

await program.parseAsync(process.argv);
