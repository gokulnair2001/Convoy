import { describe, expect, it } from "vitest";
import { DEFAULT_GATES } from "../../src/core/gate.js";
import { AmbiguousError, NotFoundError } from "../../src/core/errors.js";
import { textFieldForTyping, type Element } from "../../src/core/element.js";
import { HeuristicJevClient } from "../../src/jev/client.js";
import { Resolver } from "../../src/jev/resolver.js";
import type { JevClient, JevRequest, JevResponse } from "../../src/jev/types.js";

const login: Element[] = [
  el("e1", "button", "Back"),
  el("e2", "textfield", "Email"),
  el("e3", "textfield", "Password"),
  el("e4", "button", "Sign in"),
  el("e5", "button", "Forgot password?"),
  el("e6", "link", "Create account"),
  el("e7", "button", "Use SSO"),
  el("e8", "tab", "Home"),
  el("e9", "tab", "Settings"),
];

function el(id: string, role: Element["role"], name: string): Element {
  return { id, role, name, enabled: true, bounds: [0, 0, 0.2, 0.05], ref: { id } };
}

class ScriptedClient implements JevClient {
  constructor(private readonly response: JevResponse) {}
  async systemOne(_request: JevRequest): Promise<JevResponse> {
    return this.response;
  }
}

describe("Resolver", () => {
  it("resolves the sign in button from a recorded Jev response", async () => {
    const jev = new ScriptedClient({
      answers: {
        present: { type: "noul", noul: 0.98 },
        target: {
          type: "choice",
          choice: "e4",
          probabilities: { e1: 0.01, e4: 0.93, e7: 0.04, none: 0.01 },
        },
      },
    });
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · com.example.app");
    const hit = await resolver.resolve("the sign in button", login, `tap "the sign in button"`);
    expect(hit.element.name).toBe("Sign in");
    expect(hit.element.id).toBe("e4");
    expect(hit.target).toBeCloseTo(0.93);
  });

  it("throws NOT FOUND with an actionable message", async () => {
    const jev = new ScriptedClient({
      answers: {
        present: { type: "noul", noul: 0.08 },
        target: { type: "choice", choice: "none", probabilities: { e4: 0.04, none: 0.9 } },
      },
    });
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · com.example.app");
    await expect(resolver.resolve("the submit invoice button", login, `tap "the submit invoice button"`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(resolver.resolve("the submit invoice button", login, `tap "the submit invoice button"`)).rejects.toThrow(
      /could not tap "the submit invoice button"/,
    );
  });

  it("throws AMBIGUOUS listing the competing elements", async () => {
    const jev = new ScriptedClient({
      answers: {
        present: { type: "noul", noul: 0.97 },
        target: {
          type: "choice",
          choice: "e4",
          probabilities: { e4: 0.48, e9: 0.44, none: 0.02 },
        },
      },
    });
    const elements = [...login.slice(0, 4), el("e9", "button", "Continue as guest")];
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · com.example.app");
    try {
      await resolver.resolve("continue", elements, `tap "continue"`);
      throw new Error("expected AmbiguousError");
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousError);
      const message = (err as Error).message;
      expect(message).toMatch(/two controls match/);
      expect(message).toMatch(/Continue as guest/);
      expect(message).toMatch(/0\.48/);
      expect(message).toMatch(/0\.44/);
      expect(message).toMatch(/rephrase/);
      expect(message).not.toMatch(/AMBIGUOUS|noul/);
    }
  });

  it("heuristic client picks Sign in for the signin intent", async () => {
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · com.example.app");
    const hit = await resolver.resolve("the sign in button", login, `tap "the sign in button"`);
    expect(hit.element.name).toBe("Sign in");
  });

  it("asks Jev to match tap intent rather than the accessibility label", async () => {
    let seen: JevRequest | undefined;
    const jev: JevClient = {
      async systemOne(request) {
        seen = request;
        return {
          answers: {
            present: { type: "noul", noul: 0.98 },
            target: {
              type: "choice",
              choice: "e4",
              probabilities: { e4: 0.93, none: 0.01 },
            },
          },
        };
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · com.example.app");
    await resolver.resolve("continue", login, `tap "continue"`);
    const present = seen?.questions.present.instructions ?? "";
    const target = seen?.questions.target.instructions ?? "";
    expect(present).toMatch(/Action: tap/);
    expect(present).toMatch(/Intent: continue/);
    expect(present).toMatch(/visible label may differ/);
    expect(target).toMatch(/primary forward CTA/);
    expect(target).not.toMatch(/Which element in `elements` is: continue/);
  });

  it("does not apply forward-CTA synonym rules when typing into a field", async () => {
    let seen: JevRequest | undefined;
    const jev: JevClient = {
      async systemOne(request) {
        seen = request;
        return {
          answers: {
            present: { type: "noul", noul: 0.98 },
            target: {
              type: "choice",
              choice: "e2",
              probabilities: { e2: 0.94, none: 0.01 },
            },
          },
        };
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · com.example.app");
    await resolver.resolve("Email", login, `type into "Email"`);
    const instructions = seen?.questions.target.instructions ?? "";
    expect(instructions).toMatch(/Action: type/);
    expect(instructions).toMatch(/Intent: Email/);
    expect(instructions).not.toMatch(/primary forward CTA/);
  });
});

describe("heuristic tap intent", () => {
  const resolver = () => new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · com.example.app");

  it("taps Sign in when the author says continue and no Continue label exists", async () => {
    const hit = await resolver().resolve("continue", login, `tap "continue"`);
    expect(hit.element.name).toBe("Sign in");
    expect(hit.element.id).toBe("e4");
  });

  it("taps Continue when the author says log in and that is the unique forward button", async () => {
    const screen: Element[] = [
      el("e1", "button", "Back"),
      el("e2", "textfield", "Email"),
      el("e3", "textfield", "Password"),
      el("e4", "button", "Continue"),
      el("e5", "button", "Forgot password?"),
    ];
    const hit = await resolver().resolve("log in", screen, `tap "log in"`);
    expect(hit.element.name).toBe("Continue");
  });

  it("prefers a visible Continue label over a Log in button", async () => {
    const screen: Element[] = [
      el("e1", "button", "Back"),
      el("e4", "button", "Continue"),
      el("e5", "button", "Log in"),
    ];
    const hit = await resolver().resolve("continue", screen, `tap "continue"`);
    expect(hit.element.name).toBe("Continue");
  });

  it("taps Continue as guest only when the phrase names it", async () => {
    const screen: Element[] = [
      el("e4", "button", "Continue"),
      el("e5", "button", "Continue as guest"),
    ];
    const guest = await resolver().resolve("continue as guest", screen, `tap "continue as guest"`);
    expect(guest.element.name).toBe("Continue as guest");
    const forward = await resolver().resolve("continue", screen, `tap "continue"`);
    expect(forward.element.name).toBe("Continue");
  });

  it("does not tap a side action or invent a match for a specific missing control", async () => {
    await expect(resolver().resolve("the submit invoice button", login, `tap "the submit invoice button"`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("does not treat type-into as a forward CTA", async () => {
    await expect(resolver().resolve("continue", login, `type into "continue"`)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("textFieldForTyping", () => {
  it("retargets a label to the nearby unlabeled text field", () => {
    const label = el("e1", "text", "Email / Username");
    label.bounds = [0.1, 0.45, 0.8, 0.04];
    const field = el("e2", "textfield", "text field");
    field.bounds = [0.1, 0.5, 0.8, 0.06];
    field.value = "old@example.com";
    expect(textFieldForTyping([label, field], label)).toEqual(field);
  });
});
