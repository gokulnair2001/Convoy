import { type Element } from "../core/element.js";
import { AmbiguousError, AssertionFailedError } from "../core/errors.js";
import { screenRows, type FailureReport } from "../core/failure.js";
import { gateAssert, type AssertKind, type ChoiceAnswer, type Gates } from "../core/gate.js";
import type { JevClient, JevQuestion, JevRequest, JevResponse } from "./types.js";
import { asChoice, asScore, noulValue } from "./types.js";
import { buildJevState } from "./state.js";

export interface Assertion {
  intent: string;
  kind: AssertKind;
  min?: number;
}

export interface OracleHit {
  assertion: Assertion;
  probability: number;
  outcome: "pass" | "ambiguous" | "assert_failed";
}

export interface OracleResult {
  hits: OracleHit[];
  request: JevRequest;
  response: JevResponse;
}

export interface ClassifyResult {
  intents: string[];
  target: ChoiceAnswer;
  request: JevRequest;
  response: JevResponse;
}

/** Stable Choice keys: s0, s1, … plus `none`. */
export function whichOptionKey(index: number): string {
  return `s${index}`;
}

export function intentForWhichKey(key: string, intents: string[]): string | undefined {
  const match = /^s(\d+)$/.exec(key);
  if (match) return intents[Number(match[1])];
  return intents.find((intent) => intent === key);
}

export class Oracle {
  constructor(
    private readonly jev: JevClient,
    private readonly gates: Gates,
    private readonly screenLabel: string,
  ) {}

  /** Same questions as ask(), but never throws — used for screen branching. */
  async probe(assertions: Assertion[], elements: Element[]): Promise<OracleResult> {
    const questions: Record<string, JevQuestion> = {};
    assertions.forEach((a, i) => {
      const id = `a${i + 1}`;
      if (a.kind === "score") {
        questions[id] = {
          type: "score",
          instructions: `How completely does the current screen satisfy: ${a.intent}?`,
          criteria: ["Not at all", "Partially", "Fully"],
        };
      } else {
        questions[id] = {
          type: "noul",
          instructions: `Does \`elements\` show: ${a.intent}?`,
        };
      }
    });

    const request: JevRequest = {
      state: buildJevState(this.screenLabel, elements),
      questions,
    };

    const response = await this.jev.systemOne(request);
    const hits: OracleHit[] = assertions.map((assertion, i) => {
      const id = `a${i + 1}`;
      const value =
        assertion.kind === "score"
          ? asScore(response.answers[id]) / 2
          : noulValue(response.answers[id]);
      const decision = gateAssert(assertion.kind, value, this.gates, assertion.min);
      return { assertion, probability: value, outcome: decision.outcome };
    });

    return { hits, request, response };
  }

  /**
   * One Choice among authored screens, plus `none` for loading / anything else.
   * Does not throw — the runner retries while the gate says not_found.
   */
  async classify(intents: string[], elements: Element[]): Promise<ClassifyResult> {
    const criteria: Record<string, string | null> = {};
    intents.forEach((intent, i) => {
      criteria[whichOptionKey(i)] = intent;
    });
    criteria.none = "Still loading, or a different screen that is not any of the other options";

    const request: JevRequest = {
      state: buildJevState(this.screenLabel, elements),
      questions: {
        screen: {
          type: "choice",
          instructions:
            "Which option best describes the current screen? Use `screen.labels` (visible text) and `elements`. Pick none if the screen is still loading or does not match any option.",
          criteria,
        },
      },
    };

    const response = await this.jev.systemOne(request);
    const raw = asChoice(response.answers.screen);
    const target: ChoiceAnswer = {
      choice: raw.choice,
      probabilities: raw.probabilities,
      confidence: raw.confidence,
    };
    return { intents, target, request, response };
  }

  async ask(assertions: Assertion[], elements: Element[], step: string, traceDir?: string): Promise<OracleResult> {
    const result = await this.probe(assertions, elements);
    const failed = result.hits.find((h) => h.outcome === "assert_failed");
    if (failed) {
      throw new AssertionFailedError(assertReport(failed, elements, step, traceDir));
    }
    const ambiguous = result.hits.find((h) => h.outcome === "ambiguous");
    if (ambiguous) {
      throw new AmbiguousError(assertReport(ambiguous, elements, step, traceDir));
    }
    return result;
  }
}

function assertReport(hit: OracleHit, elements: Element[], step: string, traceDir?: string): FailureReport {
  const kind = hit.assertion.kind;
  const phrase = hit.assertion.intent;
  const verb = kind === "see.not" ? "see.not" : kind;
  const action = stepAction(step, verb);
  const yes = hit.probability;
  if (hit.outcome === "ambiguous") {
    return {
      kind: "ambiguous",
      title: `uncertain whether ${JSON.stringify(phrase)} is on screen`,
      action,
      intent: phrase,
      scores: [{ label: "yes", p: yes }],
      screen: screenRows(elements),
      hint: "the model is not sure — wait for the screen to settle, or rephrase",
      next: ["convoy inspect"],
      traceDir,
    };
  }
  if (kind === "see.not") {
    return {
      kind: "assert_failed",
      title: `saw ${JSON.stringify(phrase)} but the test expected it gone`,
      action,
      intent: phrase,
      scores: [{ label: "yes", p: yes }],
      screen: screenRows(elements),
      hint: "that content is on screen — if it is a toast, wait longer or assert after it dismisses",
      next: ["convoy inspect"],
      traceDir,
    };
  }
  if (kind === "score") {
    return {
      kind: "assert_failed",
      title: `score for ${JSON.stringify(phrase)} was too low`,
      action,
      intent: phrase,
      scores: [{ label: "score", p: yes }],
      screen: screenRows(elements),
      hint: "the screen does not match that phrase strongly enough",
      next: ["convoy inspect"],
      traceDir,
    };
  }
  return {
    kind: "assert_failed",
    title: `did not see ${JSON.stringify(phrase)}`,
    action,
    intent: phrase,
    scores: [{ label: "yes", p: yes }],
    screen: screenRows(elements),
    hint: "the phrase does not match this UI, or the screen has not loaded yet",
    next: ["convoy inspect"],
    traceDir,
  };
}

function stepAction(step: string, fallback: string): string {
  const verb = step.trim().split(/\s+/)[0] ?? fallback;
  return verb.replace(/:$/, "") || fallback;
}
