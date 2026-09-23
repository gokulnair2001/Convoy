import type { TraceScreenshots } from "../core/config.js";
import type { Driver } from "../core/driver.js";
import { formatElement, textFieldForTyping, type Element, type LogicalPlatform } from "../core/element.js";
import { AmbiguousError, AssertionFailedError, ConvoyError, NotFoundError, enrichFailure } from "../core/errors.js";
import { formatFailure, rankedScores, screenRows, type FailureReport } from "../core/failure.js";
import { gateWhich, type Gates } from "../core/gate.js";
import { waitForSettle, waitUntilPresent } from "../core/settle.js";
import type { Tracer } from "../core/trace.js";
import { intentForWhichKey, type ClassifyResult, type Oracle } from "../jev/oracle.js";
import type { ResolveHit, Resolver } from "../jev/resolver.js";
import { pause, sleep } from "../util/sleep.js";
import type { Reporter } from "./reporter.js";

export interface StepContext {
  driver: Driver;
  resolver: Resolver;
  oracle: Oracle;
  tracer: Tracer;
  reporter: Reporter;
  gates: Gates;
  platform: LogicalPlatform;
  slowMoMs: number;
  stepMode: boolean;
  actionTimeoutMs: number;
  traceScreenshots: TraceScreenshots;
}

type PlatformFns = Partial<Record<LogicalPlatform, () => Promise<void> | void>>;

export class Steps {
  constructor(private readonly ctx: StepContext) {}

  get platformName(): LogicalPlatform {
    return this.ctx.platform;
  }

  readonly see = Object.assign(this.seeYes.bind(this), {
    not: this.seeNot.bind(this),
  });

  async tap(intent: string): Promise<void> {
    await this.beforeAction();
    const started = Date.now();
    const { elements, hit } = await this.resolveWhenPresent(intent, `tap "${intent}"`);
    await this.ctx.driver.tap(hit.element);
    const ms = Date.now() - started;
    await this.ctx.tracer.recordStep({
      action: "tap",
      intent,
      outcome: "pass",
      ms,
      elements,
      request: hit.request,
      response: hit.response,
      screenshot: await this.screenshotFor("pass"),
      element: { id: hit.element.id, name: hit.element.name },
      probability: hit.target,
    });
    this.ctx.reporter.tap(intent, hit.element, hit.target, ms);
    await this.afterAction();
  }

  async type(text: string, opts: { into: string }): Promise<void> {
    await this.beforeAction();
    const started = Date.now();
    const { elements, hit } = await this.resolveWhenPresent(opts.into, `type into "${opts.into}"`);
    const target = textFieldForTyping(elements, hit.element);
    await this.ctx.driver.type(target, text);
    const ms = Date.now() - started;
    await this.ctx.tracer.recordStep({
      action: "type",
      intent: opts.into,
      outcome: "pass",
      ms,
      elements,
      request: hit.request,
      response: hit.response,
      screenshot: await this.screenshotFor("pass"),
      element: { id: target.id, name: target.name },
      probability: hit.target,
    });
    this.ctx.reporter.type(text, target, hit.target, ms);
    await this.afterAction();
  }

  async score(intent: string, opts: { min: number }): Promise<void> {
    await this.beforeAction();
    const started = Date.now();
    this.ctx.reporter.settling();
    const elements = await waitForSettle(() => this.ctx.driver.snapshot());
    const result = await this.ctx.oracle.ask(
      [{ intent, kind: "score", min: opts.min }],
      elements,
      `score "${intent}"`,
      this.ctx.tracer.dir,
    );
    const hit = result.hits[0]!;
    await this.ctx.tracer.recordStep({
      action: "score",
      intent,
      outcome: hit.outcome,
      ms: Date.now() - started,
      elements,
      request: result.request,
      response: result.response,
      screenshot: await this.screenshotFor(hit.outcome === "pass" ? "pass" : "fail"),
      probability: hit.probability,
    });
    this.ctx.reporter.score(intent, hit.probability);
  }

  async back(): Promise<void> {
    await this.beforeAction();
    await this.ctx.driver.back();
    await this.afterAction();
  }

  async resetApp(): Promise<void> {
    await this.ctx.driver.reset();
    await this.afterAction();
  }

  async platform(handlers: PlatformFns): Promise<void> {
    const fn = handlers[this.ctx.platform];
    if (fn) await fn();
  }

  /**
   * Wait until one of the screens is present, then return that intent.
   * Uses a single Choice (plus `none` for loading / other) so a 0.7 vs 0.2
   * split counts as a branch, not "neither".
   */
  async which(intents: string[]): Promise<string> {
    if (intents.length < 2) {
      throw new Error("t.which() needs at least two intents to choose between");
    }
    await this.beforeAction();
    const started = Date.now();
    this.ctx.reporter.settling();

    let lastElements: Element[] = [];
    let lastClassify: ClassifyResult | undefined;

    try {
      const { intent, probability, elements, result } = await waitUntilPresent(
        async () => {
          const elements = await this.ctx.driver.snapshot();
          lastElements = elements;
          return elements;
        },
        async (elements) => {
          const result = await this.ctx.oracle.classify(intents, elements);
          lastClassify = result;
          const decision = gateWhich(result.target, this.ctx.gates);
          if (decision.outcome === "not_found") {
            throw new NotFoundError(
              whichMissingReport(intents, elements, result.target.probabilities, this.ctx.tracer.dir),
            );
          }
          if (decision.outcome === "ambiguous") {
            throw new AmbiguousError(
              whichAmbiguousReport(intents, decision.top, elements, this.ctx.tracer.dir),
            );
          }
          const intent = intentForWhichKey(decision.optionId, intents);
          if (!intent) {
            throw new NotFoundError({
              kind: "not_found",
              title: `which resolved unknown option ${decision.optionId}`,
              action: "which",
              screen: screenRows(elements),
              hint: "the screen classifier returned an option that is not in the test",
              traceDir: this.ctx.tracer.dir,
            });
          }
          const probability = result.target.probabilities[decision.optionId] ?? 0;
          return { intent, probability, elements, result };
        },
        (err) => err instanceof NotFoundError,
        { timeoutMs: this.ctx.actionTimeoutMs },
      );
      await this.ctx.tracer.recordStep({
        action: "which",
        intent,
        outcome: "pass",
        ms: Date.now() - started,
        elements,
        request: result.request,
        response: result.response,
        screenshot: await this.screenshotFor("pass"),
        probability,
      });
      this.ctx.reporter.which(intent, probability);
      return intent;
    } catch (err) {
      const outcome =
        err instanceof AmbiguousError ? "ambiguous" : err instanceof NotFoundError ? "not_found" : "fail";
      try {
        await this.ctx.tracer.recordStep({
          action: "which",
          outcome,
          ms: Date.now() - started,
          elements: lastElements,
          request: lastClassify?.request,
          response: lastClassify?.response,
          screenshot: await this.screenshotFor("fail"),
        });
      } catch {
        // keep the original which failure even if tracing the last dump fails
      }
      if (err instanceof NotFoundError) {
        throw enrichFailure(err, {
          waitedMs: Date.now() - started,
          screen: screenRows(lastElements),
          scores: whichScores(intents, lastClassify?.target.probabilities),
          traceDir: this.ctx.tracer.dir,
        });
      }
      throw enrichFailure(err, {
        waitedMs: Date.now() - started,
        screen: screenRows(lastElements),
        traceDir: this.ctx.tracer.dir,
      });
    }
  }

  async flush(): Promise<void> {
    if (this.ctx.traceScreenshots === "all") return;
    await this.ctx.tracer.attachScreenshotToLast(await this.ctx.driver.screenshot());
  }

  async seeAll(intents: Array<string | { not: string }>): Promise<void> {
    await this.beforeAction();
    for (const item of intents) {
      if (typeof item === "string") await this.recordSee(item);
      else await this.recordSeeNot(item.not);
    }
  }

  private async seeYes(intent: string): Promise<void> {
    await this.beforeAction();
    await this.recordSee(intent);
  }

  private async seeNot(intent: string): Promise<void> {
    await this.beforeAction();
    await this.recordSeeNot(intent);
  }

  /** Exact name, then Choice among elements + none. Retries while not found. */
  private async recordSee(intent: string): Promise<void> {
    const started = Date.now();
    const { elements, hit } = await this.resolveWhenPresent(intent, `see "${intent}"`);
    await this.ctx.tracer.recordStep({
      action: "see",
      intent,
      outcome: "pass",
      ms: Date.now() - started,
      elements,
      request: hit.request,
      response: hit.response,
      screenshot: await this.screenshotFor("pass"),
      element: { id: hit.element.id, name: hit.element.name },
      probability: hit.target,
    });
    this.ctx.reporter.see(intent, hit.target, false);
  }

  /** Fail if a control matches; pass if resolve says none. Does not wait for it to vanish. */
  private async recordSeeNot(intent: string): Promise<void> {
    const started = Date.now();
    this.ctx.reporter.settling();
    const elements = await this.ctx.driver.snapshot();
    try {
      const hit = await this.ctx.resolver.resolve(intent, elements, `see.not "${intent}"`, this.ctx.tracer.dir);
      throw new AssertionFailedError({
        kind: "assert_failed",
        title: `saw ${JSON.stringify(intent)} but the test expected it gone`,
        action: "see.not",
        intent,
        scores: [{ label: formatElement(hit.element), p: hit.target }],
        screen: screenRows(elements),
        hint: "that content is on screen — if it is a toast, wait longer or assert after it dismisses",
        next: ["convoy inspect"],
        traceDir: this.ctx.tracer.dir,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        await this.ctx.tracer.recordStep({
          action: "see.not",
          intent,
          outcome: "pass",
          ms: Date.now() - started,
          elements,
          screenshot: await this.screenshotFor("pass"),
          probability: 0,
        });
        this.ctx.reporter.see(intent, 0, true);
        return;
      }
      throw enrichFailure(err, {
        waitedMs: Date.now() - started,
        screen: screenRows(elements),
        traceDir: this.ctx.tracer.dir,
      });
    }
  }

  private async resolveWhenPresent(
    intent: string,
    step: string,
  ): Promise<{ elements: Element[]; hit: ResolveHit }> {
    this.ctx.reporter.settling();
    const started = Date.now();
    let lastElements: Element[] = [];
    try {
      return await waitUntilPresent(
        async () => {
          const elements = await this.ctx.driver.snapshot();
          lastElements = elements;
          return elements;
        },
        async (elements) => {
          const hit = await this.ctx.resolver.resolve(intent, elements, step, this.ctx.tracer.dir);
          return { elements, hit };
        },
        (err) => err instanceof NotFoundError,
        { timeoutMs: this.ctx.actionTimeoutMs },
      );
    } catch (err) {
      throw enrichFailure(err, {
        waitedMs: Date.now() - started,
        screen: screenRows(lastElements),
        traceDir: this.ctx.tracer.dir,
      });
    }
  }

  private async beforeAction(): Promise<void> {
    if (this.ctx.stepMode) {
      await pause("press enter to continue… ");
    }
  }

  private async afterAction(): Promise<void> {
    if (this.ctx.slowMoMs > 0) await sleep(this.ctx.slowMoMs);
  }

  private async screenshotFor(kind: "pass" | "fail"): Promise<Buffer | undefined> {
    if (kind === "fail" || this.ctx.traceScreenshots === "all") {
      return this.ctx.driver.screenshot();
    }
    return undefined;
  }
}

function whichScores(intents: string[], probabilities: Record<string, number> | undefined) {
  const labeled: Record<string, number> = { none: probabilities?.none ?? 0 };
  for (const [i, intent] of intents.entries()) {
    labeled[intent] = probabilities?.[`s${i}`] ?? probabilities?.[intent] ?? 0;
  }
  return rankedScores(labeled);
}

function whichMissingReport(
  intents: string[],
  elements: Element[],
  probabilities: Record<string, number>,
  traceDir: string | undefined,
): FailureReport {
  return {
    kind: "not_found",
    title: `none of these screens appeared: ${intents.map((i) => JSON.stringify(i)).join(", ")}`,
    action: "which",
    scores: whichScores(intents, probabilities),
    screen: screenRows(elements),
    hint: "still waiting for one of those screens — navigation may not have finished, or the labels do not match this UI",
    next: ["convoy inspect"],
    traceDir,
  };
}

function whichAmbiguousReport(
  intents: string[],
  top: Array<{ id: string; p: number }>,
  elements: Element[],
  traceDir?: string,
): FailureReport {
  return {
    kind: "ambiguous",
    title: "which screen is this? two options match",
    action: "which",
    scores: top
      .filter((t) => t.id !== "none")
      .map((t) => ({ label: JSON.stringify(intentForWhichKey(t.id, intents) ?? t.id), p: t.p })),
    screen: screenRows(elements),
    hint: "these lead to different screens — make the phrases more specific",
    next: ["convoy inspect"],
    traceDir,
  };
}

export function rethrowWithTrace(err: unknown, testName: string, file: string, reporter: Reporter): never {
  const enriched =
    err instanceof ConvoyError
      ? enrichFailure(err, { traceDir: err.traceDir ?? err.report.traceDir })
      : err;
  const message =
    enriched instanceof ConvoyError
      ? formatFailure(enriched.report)
      : enriched instanceof Error
        ? enriched.message
        : String(enriched);
  reporter.fail(testName, file, message);
  throw enriched instanceof Error ? enriched : err;
}
