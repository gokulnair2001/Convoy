import { expandSecret, type NormalizedStep } from "./parse.js";
import { expandEnv } from "../util/expand.js";

/**
 * Minimal Steps surface used by YAML. Matches the existing runner API
 * (`t.see.not` plus an optional `see.not` property for mocks).
 */
export interface YamlSteps {
  tap(intent: string): Promise<void>;
  type(text: string, opts: { into: string }): Promise<void>;
  see: ((intent: string) => Promise<void>) & { not: (intent: string) => Promise<void> };
  which(intents: string[]): Promise<string>;
  back(): Promise<void>;
}

export async function executeSteps(
  t: YamlSteps,
  steps: NormalizedStep[],
  loc: { file: string } = { file: "yaml" },
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    switch (step.kind) {
      case "tap":
        await t.tap(expandEnv(step.intent));
        break;
      case "type":
        await t.type(expandSecret(step.text, loc.file, `step[${index}]`), { into: expandEnv(step.into) });
        break;
      case "see":
        await t.see(expandEnv(step.intent));
        break;
      case "see.not":
        await callSeeNot(t, expandEnv(step.intent));
        break;
      case "back":
        await t.back();
        break;
      case "which": {
        const intents = Object.keys(step.branches);
        const matched = await t.which(intents);
        const nested = step.branches[matched];
        if (nested === undefined) {
          throw new Error(
            `which matched ${JSON.stringify(matched)}, which is not one of ${intents.map((i) => JSON.stringify(i)).join(", ")}`,
          );
        }
        await executeSteps(t, nested, loc);
        break;
      }
    }
  }
}

async function callSeeNot(t: YamlSteps, intent: string): Promise<void> {
  if (typeof t.see?.not === "function") {
    await t.see.not(intent);
    return;
  }
  const alt = (t as { "see.not"?: (value: string) => Promise<void> })["see.not"];
  if (typeof alt === "function") {
    await alt(intent);
    return;
  }
  throw new Error("Steps is missing see.not");
}
