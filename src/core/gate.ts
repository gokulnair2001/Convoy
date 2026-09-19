import { AmbiguousError, NotFoundError } from "./errors.js";
import { formatElement, type Element } from "./element.js";
import { screenRows, type FailureReport, type FailureScore } from "./failure.js";

export interface Gates {
  presence: number;
  none: number;
  target: number;
  gap: number;
  assertion: number;
}

export const DEFAULT_GATES: Gates = {
  presence: 0.9,
  none: 0.1,
  target: 0.75,
  gap: 0.2,
  assertion: 0.85,
};

export interface ChoiceAnswer {
  choice: string;
  confidence?: number;
  probabilities: Record<string, number>;
}

export interface ResolveAnswers {
  present: number;
  target: ChoiceAnswer;
}

export type ResolveDecision =
  | { outcome: "pass"; elementId: string }
  | { outcome: "not_found"; reason: string }
  | { outcome: "ambiguous"; reason: string; top: Array<{ id: string; p: number }> };

export function rankedProbabilities(
  probabilities: Record<string, number>,
): Array<{ id: string; p: number }> {
  return Object.entries(probabilities)
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => b.p - a.p);
}

export function gateResolve(answers: ResolveAnswers, gates: Gates = DEFAULT_GATES): ResolveDecision {
  const ranked = rankedProbabilities(answers.target.probabilities);
  const noneP = answers.target.probabilities.none ?? 0;
  const top = ranked[0];
  const second = ranked[1];
  const gap = top && second ? top.p - second.p : top?.p ?? 0;
  const choiceClear =
    Boolean(top) && top!.id !== "none" && noneP < gates.none && (top!.p >= gates.target || gap >= gates.gap);

  // Live Jev often scores present ~0.7 while Choice is already sure (e.g. e3 0.99, none 0.01).
  // Trust the Choice when it is clear; only require the noul when Choice is not.
  if (noneP >= gates.none || (!choiceClear && answers.present < gates.presence)) {
    return {
      outcome: "not_found",
      reason: formatNotFound(answers.present, noneP, gates),
    };
  }

  if (!top || top.id === "none") {
    return {
      outcome: "not_found",
      reason: formatNotFound(answers.present, noneP, gates),
    };
  }

  if (top.p >= gates.target) {
    return { outcome: "pass", elementId: top.id };
  }

  if (gap < gates.gap) {
    return {
      outcome: "ambiguous",
      reason: "top-two probabilities are too close to pick a single control",
      top: ranked.slice(0, 3),
    };
  }

  return { outcome: "pass", elementId: top.id };
}

export type WhichDecision =
  | { outcome: "pass"; optionId: string }
  | { outcome: "not_found"; reason: string }
  | { outcome: "ambiguous"; reason: string; top: Array<{ id: string; p: number }> };

/**
 * Branch among authored screens. `none` means still loading / a different screen
 * (retry). Unlike resolve, a 0.10 none mass does not veto a clear screen winner.
 */
export function gateWhich(target: ChoiceAnswer, gates: Gates = DEFAULT_GATES): WhichDecision {
  const ranked = rankedProbabilities(target.probabilities);
  const screens = ranked.filter((r) => r.id !== "none");
  const noneP = target.probabilities.none ?? 0;
  const top = screens[0];
  const second = screens[1];

  if (!top || noneP >= top.p) {
    return {
      outcome: "not_found",
      reason: `none ${noneP.toFixed(2)} is at least as likely as any listed screen`,
    };
  }

  if (second && second.p > noneP && top.p - second.p < gates.gap) {
    return {
      outcome: "ambiguous",
      reason: "top-two screens are too close to pick one branch",
      top: ranked.slice(0, 3),
    };
  }

  if (top.p >= gates.target || top.p - noneP >= gates.gap) {
    return { outcome: "pass", optionId: top.id };
  }

  return {
    outcome: "not_found",
    reason: `best screen ${top.id} ${top.p.toFixed(2)} is too weak to commit`,
  };
}

export function throwResolve(
  decision: ResolveDecision,
  elements: Element[],
  intent: string,
  step: string,
  traceDir?: string,
): asserts decision is { outcome: "pass"; elementId: string } {
  if (decision.outcome === "pass") return;
  const phrase = stripQuotes(intent);
  const action = stepAction(step);

  if (decision.outcome === "not_found") {
    throw new NotFoundError(
      resolveNotFoundReport({ phrase, action, step, elements, reason: decision.reason, traceDir }),
    );
  }

  const scores: FailureScore[] = decision.top
    .filter((t) => t.id !== "none")
    .map((t) => {
      const el = elements.find((e) => e.id === t.id);
      return { label: el ? formatElement(el) : `[${t.id}]`, p: t.p };
    });

  throw new AmbiguousError({
    kind: "ambiguous",
    title: `could not ${action} ${JSON.stringify(phrase)} — two controls match`,
    action,
    intent: phrase,
    scores,
    screen: screenRows(elements),
    hint: "rephrase so only one control matches",
    next: ["convoy inspect"],
    traceDir,
  });
}

export function resolveNotFoundReport(opts: {
  phrase: string;
  action: string;
  step: string;
  elements: Element[];
  reason: string;
  traceDir?: string;
}): FailureReport {
  return {
    kind: "not_found",
    title: `could not ${opts.action} ${JSON.stringify(opts.phrase)}`,
    action: opts.action,
    intent: opts.phrase,
    scores: scoresFromReason(opts.reason),
    screen: screenRows(opts.elements),
    hint: "that control is not on this screen — inspect the live UI and rephrase, or it is a product bug",
    next: ["convoy inspect"],
    traceDir: opts.traceDir,
  };
}

function scoresFromReason(reason: string): FailureScore[] | undefined {
  const present = reason.match(/present\s+(\d+\.\d+)/);
  const none = reason.match(/none\s+(\d+\.\d+)/);
  if (!present && !none) return undefined;
  const scores: FailureScore[] = [];
  if (present) scores.push({ label: "present", p: Number(present[1]) });
  if (none) scores.push({ label: "none", p: Number(none[1]) });
  return scores;
}

function stripQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function stepAction(step: string): string {
  const verb = step.trim().split(/\s+/)[0] ?? step;
  return verb.replace(/:$/, "") || "tap";
}

export type AssertKind = "see" | "see.not" | "score";

export interface AssertDecision {
  outcome: "pass" | "ambiguous" | "assert_failed";
  probability: number;
  reason?: string;
}

export function gateAssert(
  kind: AssertKind,
  value: number,
  gates: Gates = DEFAULT_GATES,
  min?: number,
): AssertDecision {
  if (kind === "score") {
    const threshold = min ?? gates.assertion;
    if (value >= threshold) return { outcome: "pass", probability: value };
    return {
      outcome: "assert_failed",
      probability: value,
      reason: `score ${value.toFixed(2)} is below min ${threshold}`,
    };
  }

  const yes = gates.assertion;
  const no = 1 - gates.assertion;

  if (kind === "see") {
    if (value >= yes) return { outcome: "pass", probability: value };
    if (value <= no) {
      return {
        outcome: "assert_failed",
        probability: value,
        reason: `expected to see this, noul=${value.toFixed(2)}`,
      };
    }
    return {
      outcome: "ambiguous",
      probability: value,
      reason: `noul ${value.toFixed(2)} is uncertain (near 0.5), not a yes or no`,
    };
  }

  if (value <= no) return { outcome: "pass", probability: value };
  if (value >= yes) {
    return {
      outcome: "assert_failed",
      probability: value,
      reason: `expected not to see this, noul=${value.toFixed(2)}`,
    };
  }
  return {
    outcome: "ambiguous",
    probability: value,
    reason: `noul ${value.toFixed(2)} is uncertain (near 0.5), not a yes or no`,
  };
}

function formatNotFound(present: number, noneP: number, gates: Gates): string {
  return `present ${present.toFixed(2)} (need > ${gates.presence.toFixed(2)}), none ${noneP.toFixed(2)} (need < ${gates.none.toFixed(2)})`;
}
