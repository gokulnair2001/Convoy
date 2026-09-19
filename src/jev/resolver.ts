import { type Element } from "../core/element.js";
import { NotFoundError } from "../core/errors.js";
import { screenRows } from "../core/failure.js";
import { gateResolve, throwResolve, type Gates } from "../core/gate.js";
import type { JevClient, JevRequest, JevResponse } from "./types.js";
import { asChoice, noulValue } from "./types.js";
import { buildJevState } from "./state.js";

export interface ResolveHit {
  element: Element;
  present: number;
  target: number;
  none: number;
  request: JevRequest;
  response: JevResponse;
}

export class Resolver {
  constructor(
    private readonly jev: JevClient,
    private readonly gates: Gates,
    private readonly screenLabel: string,
  ) {}

  async resolve(intent: string, elements: Element[], step: string, traceDir?: string): Promise<ResolveHit> {
    const criteria: Record<string, string | null> = {};
    for (const el of elements) {
      criteria[el.id] = `${el.role} "${el.name}"${el.value ? ` value=${JSON.stringify(el.value)}` : ""}`;
    }
    criteria.none = "No unique control fulfills the intent";
    const action = actionFromStep(step);

    const request: JevRequest = {
      state: buildJevState(this.screenLabel, elements, { includeValues: true }),
      questions: {
        present: {
          type: "noul",
          instructions: resolveInstructions("present", action, intent),
        },
        target: {
          type: "choice",
          instructions: resolveInstructions("target", action, intent),
          criteria,
        },
      },
    };

    const response = await this.jev.systemOne(request);
    const present = noulValue(response.answers.present);
    const target = asChoice(response.answers.target);
    const decision = gateResolve({ present, target }, this.gates);

    if (decision.outcome !== "pass") {
      throwResolve(decision, elements, `"${intent}"`, step, traceDir);
    }

    const element = elements.find((e) => e.id === decision.elementId);
    if (!element) {
      throw new NotFoundError({
        kind: "not_found",
        title: `could not ${step.split(/\s+/)[0] ?? "tap"} ${JSON.stringify(intent)}`,
        action: step.split(/\s+/)[0] ?? "tap",
        intent,
        screen: screenRows(elements),
        hint: `resolved ${decision.elementId} is missing from the element table`,
        next: ["convoy inspect"],
        traceDir,
      });
    }

    const none = target.probabilities.none ?? 0;
    const targetP = target.probabilities[element.id] ?? 0;

    return {
      element,
      present,
      target: targetP,
      none,
      request,
      response,
    };
  }
}

export type ResolveAction = "tap" | "type";

export function actionFromStep(step: string): ResolveAction {
  return /^\s*type\b/i.test(step) ? "type" : "tap";
}

/** Shared footer so the heuristic client can parse action + phrase. */
export function resolveInstructions(kind: "present" | "target", action: ResolveAction, intent: string): string {
  const rules =
    action === "tap"
      ? "The author's phrase is an intent; the visible label may differ. If one control's visible name matches the phrase (ignore case and punctuation), pick that control. If none match, the unique primary forward CTA (continue, next, submit, log in, sign in, done, save) may match even when the label differs. Side actions (Forgot password, Continue as guest, Use SSO, Create account) only match when the phrase names them. If two controls fit equally, pick none."
      : "The author's phrase is an intent; the visible label may differ. If one field's visible name matches the phrase (ignore case and punctuation), pick that field. Prefer text fields. If two fields fit equally, pick none.";
  const ask =
    kind === "present"
      ? `Does \`elements\` contain a unique ${action === "type" ? "field" : "control"} that fulfills this ${action}?`
      : `Which ${action === "type" ? "field" : "control"} in \`elements\` should be used to ${action}?`;
  return `${ask} ${rules}\nAction: ${action}\nIntent: ${intent}`;
}
