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
