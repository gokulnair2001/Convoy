import { describe, expect, it } from "vitest";
import { DEFAULT_GATES } from "../../src/core/gate.js";
import { AmbiguousError, NotFoundError } from "../../src/core/errors.js";
import { elementsWithExactName, textFieldForTyping, uniqueFieldForTyping, type Element } from "../../src/core/element.js";
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
    await resolver.resolve("the email field", login, `type into "the email field"`);
    const instructions = seen?.questions.target.instructions ?? "";
    expect(instructions).toMatch(/Action: type/);
    expect(instructions).toMatch(/Intent: the email field/);
    expect(instructions).toMatch(/heading\/label and a text field/);
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

describe("uniqueFieldForTyping", () => {
  it("picks the field when a heading and the field share Username", () => {
    const heading = el("e1", "text", "Username");
    const field = el("e6", "textfield", "Username");
    const continueBtn = el("e2", "button", "Continue");
    expect(uniqueFieldForTyping([heading, field, continueBtn])?.id).toBe("e6");
  });

  it("stays unresolved when two fields share the name", () => {
    expect(
      uniqueFieldForTyping([el("e1", "textfield", "Username"), el("e2", "textfield", "Username")]),
    ).toBeUndefined();
  });

  it("stays unresolved when two different fields compete", () => {
    expect(uniqueFieldForTyping([el("e2", "textfield", "Email"), el("e3", "textfield", "Password")])).toBeUndefined();
  });
});

describe("type resolve", () => {
  const usernameScreen: Element[] = [
    el("e1", "text", "Username"),
    el("e2", "button", "Continue"),
    el("e3", "text", "Convoy Tasks"),
    el("e4", "text", "Sign in to manage your day"),
    el("e6", "textfield", "Username"),
    el("e7", "text", "Demo hint: any username works"),
  ];

  it("types into the Username field when a heading duplicates that name", async () => {
    let calls = 0;
    const jev: JevClient = {
      async systemOne() {
        calls += 1;
        throw new Error("label+field same name must not call Jev");
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · app");
    const hit = await resolver.resolve("Username", usernameScreen, `type into "Username"`);
    expect(calls).toBe(0);
    expect(hit.element.id).toBe("e6");
    expect(hit.element.role).toBe("textfield");
  });

  it("still sees Username as ambiguous when the heading and field share the name", async () => {
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    await expect(resolver.resolve("Username", usernameScreen, `see "Username"`)).rejects.toBeInstanceOf(AmbiguousError);
  });

  it("collapses a 0.56/0.43 Jev split between the heading and the field", async () => {
    const jev: JevClient = {
      async systemOne() {
        return {
          answers: {
            present: { type: "noul", noul: 0.97 },
            target: {
              type: "choice",
              choice: "e1",
              probabilities: { e1: 0.56, e6: 0.43, none: 0.01 },
            },
          },
        };
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · app");
    const hit = await resolver.resolve("the username field", usernameScreen, `type into "the username field"`);
    expect(hit.element.id).toBe("e6");
    expect(hit.element.role).toBe("textfield");
  });

  it("stays ambiguous when two Username fields compete", async () => {
    const screen = [el("e1", "textfield", "Username"), el("e2", "textfield", "Username")];
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    await expect(resolver.resolve("Username", screen, `type into "Username"`)).rejects.toBeInstanceOf(AmbiguousError);
  });
});

describe("see resolve", () => {
  const emailForm: Element[] = [
    el("e1", "textfield", "text field"),
    el("e2", "button", "Continue"),
    el("e3", "text", "Motive Driver"),
    el("e4", "text", "Email / Username"),
  ];

  it("passes on an exact visible name without calling Jev", async () => {
    let calls = 0;
    const jev: JevClient = {
      async systemOne() {
        calls += 1;
        throw new Error("exact match must not call Jev");
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · app");
    const hit = await resolver.resolve("log in", [el("e5", "button", "Log in"), ...emailForm], `see "log in"`);
    expect(calls).toBe(0);
    expect(hit.element.name).toBe("Log in");
    expect(hit.target).toBe(1);
  });

  it("throws ambiguous when two controls share the visible name", async () => {
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    const screen = [el("e1", "button", "OK"), el("e2", "button", "OK")];
    await expect(resolver.resolve("OK", screen, `see "OK"`)).rejects.toBeInstanceOf(AmbiguousError);
  });

  it("does not treat Continue as Log in on the email form", async () => {
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    await expect(resolver.resolve("Log in", emailForm, `see "Log in"`)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not apply tap forward-CTA synonyms when seeing", async () => {
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    await expect(resolver.resolve("continue", login, `see "continue"`)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("picks a paraphrased label via Choice when no exact name exists", async () => {
    const jev: JevClient = {
      async systemOne(request) {
        expect(request.questions.present).toBeUndefined();
        expect(request.questions.target?.type).toBe("choice");
        expect(request.questions.target?.instructions).toMatch(/Action: see/);
        expect(request.questions.target?.instructions).not.toMatch(/primary forward CTA/);
        return {
          answers: {
            target: {
              type: "choice",
              choice: "e4",
              probabilities: { e4: 0.91, e2: 0.04, none: 0.03 },
            },
          },
        };
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · app");
    const hit = await resolver.resolve("the email field", emailForm, `see "the email field"`);
    expect(hit.element.name).toBe("Email / Username");
  });

  it("drops a 0.47 winner instead of calling the screen a match", async () => {
    const jev: JevClient = {
      async systemOne() {
        return {
          answers: {
            target: {
              type: "choice",
              choice: "e2",
              probabilities: { e2: 0.47, e4: 0.08, none: 0.08 },
            },
          },
        };
      },
    };
    const resolver = new Resolver(jev, DEFAULT_GATES, "iOS · app");
    await expect(resolver.resolve("Log in", emailForm, `see "Log in"`)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("heuristic see finds Trip list for the trip list screen", async () => {
    const trips: Element[] = [el("e1", "text", "Trip list"), el("e2", "cell", "Oakland to San Jose")];
    const resolver = new Resolver(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    const hit = await resolver.resolve("the trip list screen", trips, `see "the trip list screen"`);
    expect(hit.element.name).toBe("Trip list");
  });
});

describe("elementsWithExactName", () => {
  it("folds case and punctuation", () => {
    const screen = [el("e1", "button", "Log in"), el("e2", "button", "Continue")];
    expect(elementsWithExactName(screen, "log-in").map((e) => e.id)).toEqual(["e1"]);
  });
});
