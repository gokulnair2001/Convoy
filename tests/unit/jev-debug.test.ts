import { describe, expect, it } from "vitest";
import {
  formatJevRequest,
  formatJevResponse,
  formatJevThrown,
  wrapJevDebug,
} from "../../src/jev/debug.js";
import type { JevClient, JevRequest, JevResponse } from "../../src/jev/types.js";

const request: JevRequest = {
  state: {
    screen: "iOS · app",
    elements: [
      { id: "e1", role: "button", name: "Log in" },
      { id: "e2", role: "textfield", name: "Password", value: "secret" },
    ],
  },
  questions: {
    screen: {
      type: "choice",
      instructions: "Which option best describes what `elements` currently show?",
      criteria: {
        s0: "logged in on another device",
        s1: "the home screen",
        none: "Still loading, or a different screen",
      },
    },
  },
};

describe("jev debug", () => {
  it("prints the question, criteria, and labelled controls without field values", () => {
    const text = formatJevRequest(1, request);
    expect(text).toMatch(/jev #1 {2}question/);
    expect(text).toContain("Which option best describes");
    expect(text).toContain('s0: logged in on another device');
    expect(text).toContain('s1: the home screen');
    expect(text).toContain('"Log in"');
    expect(text).toContain('"Password"');
    expect(text).not.toContain("secret");
  });

  it("prints screen title and labels when present on state", () => {
    const text = formatJevRequest(1, {
      ...request,
      state: {
        screen: {
          platform: "iOS · app",
          title: "Example App",
          labels: ["Example App", "Password", "Log in"],
        },
        elements: request.state && typeof request.state === "object" ? (request.state as { elements: unknown }).elements : [],
      },
    });
    expect(text).toContain('title="Example App"');
    expect(text).toContain('labels "Example App"  "Password"  "Log in"');
  });

  it("prints the choice Jev returned", () => {
    const text = formatJevResponse(
      1,
      {
        answers: {
          screen: {
            type: "choice",
            choice: "none",
            probabilities: { none: 0.82, s0: 0.1, s1: 0.08 },
          },
        },
        usage: { input_tokens: 120 },
      },
      412,
    );
    expect(text).toMatch(/jev #1 {2}result/);
    expect(text).toContain("412ms");
    expect(text).toContain("120 in");
    expect(text).toContain("choice  none");
    expect(text).toContain("none 0.82");
  });

  it("prints a thrown Jev error", () => {
    const text = formatJevThrown(2, new Error("Jev HTTP 500: boom"), 80);
    expect(text).toMatch(/jev #2 {2}thrown/);
    expect(text).toContain("Jev HTTP 500: boom");
    expect(text).toContain("80ms");
  });

  it("logs question then result, and rethrows after logging the error", async () => {
    const lines: string[] = [];
    const inner: JevClient = {
      async systemOne(): Promise<JevResponse> {
        throw new Error("Jev HTTP 429: ratelimited");
      },
    };
    const client = wrapJevDebug(inner, { enabled: true, log: (line) => lines.push(line) });
    await expect(client.systemOne(request)).rejects.toThrow("Jev HTTP 429");
    expect(lines[0]).toMatch(/question/);
    expect(lines[1]).toMatch(/thrown/);
    expect(lines[1]).toContain("Jev HTTP 429: ratelimited");
  });

  it("does not wrap when debug is off", async () => {
    let calls = 0;
    const inner: JevClient = {
      async systemOne(): Promise<JevResponse> {
        calls += 1;
        return { answers: { present: { type: "noul", noul: 0.9 } } };
      },
    };
    const lines: string[] = [];
    const client = wrapJevDebug(inner, { enabled: false, log: (line) => lines.push(line) });
    await client.systemOne(request);
    expect(calls).toBe(1);
    expect(lines).toEqual([]);
  });
});
