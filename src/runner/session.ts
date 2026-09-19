import type { ConvoyConfig } from "../core/config.js";
import type { Driver } from "../core/driver.js";
import type { LogicalPlatform } from "../core/element.js";
import { Tracer } from "../core/trace.js";
import { createDriver } from "../drivers/create.js";
import { createJevClient } from "../jev/client.js";
import type { JevClient } from "../jev/types.js";
import { Oracle } from "../jev/oracle.js";
import { Resolver } from "../jev/resolver.js";
import { Reporter } from "./reporter.js";
import { Steps } from "./steps.js";

export interface Session {
  steps: Steps;
  driver: Driver;
  tracer: Tracer;
  reporter: Reporter;
  close: () => Promise<void>;
}

export interface SessionDeps {
  driver?: Driver;
  jev?: JevClient;
}

export async function createSession(
  config: ConvoyConfig,
  testName?: string,
  deps: SessionDeps = {},
): Promise<Session> {
  const driver = deps.driver ?? (await createDriver(config));
  const jev = deps.jev ?? (await createJevClient(config.jev));
  const logical: LogicalPlatform =
    config.platform === "fixture" ? config.fixture.emulatePlatform : config.platform;
  const screenLabel = `${label(logical)} · ${config.app.bundleId}`;
  const tracer = new Tracer(config.tracesDir, logical, testName);
  await tracer.begin();
  const reporter = new Reporter(process.env.CONVOY_HEADLESS === "1");
  const resolver = new Resolver(jev, config.gates, screenLabel);
  const oracle = new Oracle(jev, config.gates, screenLabel);
  const steps = new Steps({
    driver,
    resolver,
    oracle,
    tracer,
    reporter,
    gates: config.gates,
    platform: logical,
    slowMoMs: config.slowMoMs,
    stepMode: config.stepMode,
    actionTimeoutMs: config.actionTimeoutMs,
  });
  return {
    steps,
    driver,
    tracer,
    reporter,
    close: async () => {
      await driver.close();
    },
  };
}

function label(platform: LogicalPlatform): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Web";
}
