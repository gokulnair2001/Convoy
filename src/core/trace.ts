import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toPublicElement, type Element } from "./element.js";

export interface StepTrace {
  index: number;
  action: string;
  intent?: string;
  outcome: string;
  ms: number;
  element?: { id: string; name: string };
  probability?: number;
}

export interface TraceSummary {
  startedAt: string;
  platform: string;
  test?: string;
  steps: StepTrace[];
  costs: { inputTokens: number; requests: number };
  outcome: "pass" | "fail";
  error?: string;
}

export class Tracer {
  readonly dir: string;
  private readonly summary: TraceSummary;
  private stepIndex = 0;

  constructor(rootDir: string, platform: string, testName?: string, now = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.dir = path.join(rootDir, stamp);
    this.summary = {
      startedAt: now.toISOString(),
      platform,
      test: testName,
      steps: [],
      costs: { inputTokens: 0, requests: 0 },
      outcome: "pass",
    };
  }

  async begin(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async recordStep(input: {
    action: string;
    intent?: string;
    outcome: string;
    ms: number;
    elements: Element[];
    request?: unknown;
    response?: unknown;
    screenshot?: Buffer;
    element?: { id: string; name: string };
    probability?: number;
    inputTokens?: number;
  }): Promise<string> {
    this.stepIndex += 1;
    const name = `step-${String(this.stepIndex).padStart(2, "0")}`;
    const stepDir = path.join(this.dir, name);
    await mkdir(stepDir, { recursive: true });

    await writeJson(path.join(stepDir, "elements.json"), input.elements.map(toPublicElement));
    if (input.request !== undefined) await writeJson(path.join(stepDir, "request.json"), input.request);
    if (input.response !== undefined) await writeJson(path.join(stepDir, "response.json"), input.response);
    if (input.screenshot) await writeFile(path.join(stepDir, "screen.png"), input.screenshot);

    this.summary.steps.push({
      index: this.stepIndex,
      action: input.action,
      intent: input.intent,
      outcome: input.outcome,
      ms: input.ms,
      element: input.element,
      probability: input.probability,
    });
    this.summary.costs.requests += input.request !== undefined ? 1 : 0;
    this.summary.costs.inputTokens += input.inputTokens ?? 0;
    return stepDir;
  }

  async finish(outcome: "pass" | "fail", error?: string): Promise<void> {
    this.summary.outcome = outcome;
    if (error) this.summary.error = error;
    await mkdir(this.dir, { recursive: true });
    await writeJson(path.join(this.dir, "summary.json"), this.summary);
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
