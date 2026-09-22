import { elementsWithExactName, uniqueFieldForTyping, type Element } from "../core/element.js";
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
    const action = actionFromStep(step);
    if (action === "type") {
      const exact = elementsWithExactName(elements, intent);
      const field = uniqueFieldForTyping(exact);
      if (field) {
        return exactHit(field, intent, elements, action, this.screenLabel);
      }
      const exactFields = exact.filter((el) => el.role === "textfield");
      if (exactFields.length > 1) {
        throwResolve(
          {
            outcome: "ambiguous",
            reason: "two or more fields have this visible name",
            top: exactFields.map((el) => ({ id: el.id, p: 1 })),
          },
          elements,
          `"${intent}"`,
          step,
          traceDir,
        );
      }
    }
    if (action === "see") {
      const exact = elementsWithExactName(elements, intent);
      if (exact.length === 1) {
        return exactHit(exact[0]!, intent, elements, action, this.screenLabel);
      }
      if (exact.length > 1) {
        throwResolve(
          {
            outcome: "ambiguous",
            reason: "two or more controls have this visible name",
            top: exact.map((el) => ({ id: el.id, p: 1 })),
          },
          elements,
          `"${intent}"`,
          step,
          traceDir,
        );
      }
    }

    const criteria: Record<string, string | null> = {};
    for (const el of elements) {
      criteria[el.id] = `${el.role} "${el.name}"${el.value ? ` value=${JSON.stringify(el.value)}` : ""}`;
    }
    criteria.none = "No unique control fulfills the intent";

    const request: JevRequest = {
      state: buildJevState(this.screenLabel, elements, { includeValues: action !== "see" }),
      questions:
        action === "see"
          ? {
              target: {
                type: "choice",
                instructions: resolveInstructions("target", action, intent),
                criteria,
              },
            }
          : {
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
    const target = asChoice(response.answers.target);
    const present = action === "see" ? 1 : noulValue(response.answers.present);
    const decision = gateResolve({ present, target }, this.gates, action === "see" ? { strictTarget: true } : undefined);

    if (decision.outcome === "ambiguous" && action === "type") {
      const competitors = decision.top
        .filter((t) => t.id !== "none")
        .map((t) => elements.find((e) => e.id === t.id))
        .filter((el): el is Element => Boolean(el));
      const field = uniqueFieldForTyping(competitors);
      if (field) {
        return {
          element: field,
          present,
          target: target.probabilities[field.id] ?? 0,
          none: target.probabilities.none ?? 0,
          request,
          response,
        };
      }
    }

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

export type ResolveAction = "tap" | "type" | "see";

export function actionFromStep(step: string): ResolveAction {
  if (/^\s*type\b/i.test(step)) return "type";
  if (/^\s*see\b/i.test(step)) return "see";
  return "tap";
}

/** Shared footer so the heuristic client can parse action + phrase. */
export function resolveInstructions(kind: "present" | "target", action: ResolveAction, intent: string): string {
  const rules =
    action === "tap"
      ? "The author's phrase is an intent; the visible label may differ. If one control's visible name matches the phrase (ignore case and punctuation), pick that control. If none match, the unique primary forward CTA (continue, next, submit, log in, sign in, done, save) may match even when the label differs. Side actions (Forgot password, Continue as guest, Use SSO, Create account) only match when the phrase names them. If two controls fit equally, pick none."
      : action === "see"
        ? "The author's phrase is an intent; the visible label may differ. If one control's visible name matches the phrase (ignore case and punctuation), pick that control. Otherwise pick the unique control whose name means the same thing. Do not infer from the kind of screen. Do not pick a unique forward CTA (continue, next, log in) unless the phrase names that action or that label. If two controls fit equally, or none do, pick none."
        : "The author's phrase is an intent; the visible label may differ. If one field's visible name matches the phrase (ignore case and punctuation), pick that field. Prefer text fields. If a heading/label and a text field share the same visible name, pick the field. If two fields fit equally, pick none.";
  const ask =
    kind === "present"
      ? `Does \`elements\` contain a unique ${action === "type" ? "field" : "control"} that fulfills this ${action}?`
      : action === "see"
        ? "Which control in `elements` is this intent pointing at? Pick none if it is not on screen."
        : `Which ${action === "type" ? "field" : "control"} in \`elements\` should be used to ${action}?`;
  return `${ask} ${rules}\nAction: ${action}\nIntent: ${intent}`;
}

function exactHit(
  element: Element,
  intent: string,
  elements: Element[],
  action: ResolveAction,
  screenLabel: string,
): ResolveHit {
  const criteria: Record<string, string | null> = {};
  for (const el of elements) {
    criteria[el.id] = `${el.role} "${el.name}"`;
  }
  criteria.none = "No unique control fulfills the intent";
  const request: JevRequest = {
    state: buildJevState(screenLabel, elements, { includeValues: action !== "see" }),
    questions: {
      target: {
        type: "choice",
        instructions: `Exact visible name match.\nAction: ${action}\nIntent: ${intent}`,
        criteria,
      },
    },
  };
  const response: JevResponse = {
    answers: {
      target: {
        type: "choice",
        choice: element.id,
        probabilities: { [element.id]: 1, none: 0 },
        confidence: 1,
      },
    },
  };
  return {
    element,
    present: 1,
    target: 1,
    none: 0,
    request,
    response,
  };
}
