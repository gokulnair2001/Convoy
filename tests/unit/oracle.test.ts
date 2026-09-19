import { describe, expect, it } from "vitest";
import { DEFAULT_GATES } from "../../src/core/gate.js";
import { AssertionFailedError } from "../../src/core/errors.js";
import type { Element } from "../../src/core/element.js";
import { HeuristicJevClient } from "../../src/jev/client.js";
import { Oracle } from "../../src/jev/oracle.js";
import type { JevClient, JevRequest, JevResponse } from "../../src/jev/types.js";

const trips: Element[] = [
  { id: "e1", role: "text", name: "Trip list", enabled: true, bounds: [0, 0, 0.4, 0.05], ref: {} },
  { id: "e2", role: "cell", name: "Oakland to San Jose", enabled: true, bounds: [0, 0.2, 0.9, 0.1], ref: {} },
];

class ScriptedClient implements JevClient {
  constructor(private readonly response: JevResponse) {}
  async systemOne(_request: JevRequest): Promise<JevResponse> {
    return this.response;
  }
}

describe("Oracle", () => {
  it("batches sibling assertions in one Jev request", async () => {
    let calls = 0;
    const jev: JevClient = {
      async systemOne(request) {
        calls += 1;
        expect(Object.keys(request.questions)).toEqual(["a1", "a2"]);
        return {
          answers: {
            a1: { type: "noul", noul: 0.96 },
            a2: { type: "noul", noul: 0.04 },
          },
        };
      },
    };
    const oracle = new Oracle(jev, DEFAULT_GATES, "iOS · com.example.app");
    const result = await oracle.ask(
      [
        { intent: "the trip list screen", kind: "see" },
        { intent: "an error message", kind: "see.not" },
      ],
      trips,
      "see",
    );
    expect(calls).toBe(1);
    expect(result.hits.every((h) => h.outcome === "pass")).toBe(true);
  });

  it("probe does not throw when an assertion fails", async () => {
    const oracle = new Oracle(
      new ScriptedClient({ answers: { a1: { type: "noul", noul: 0.05 } } }),
      DEFAULT_GATES,
      "iOS · app",
    );
    const result = await oracle.probe([{ intent: "the trip list screen", kind: "see" }], trips);
    expect(result.hits[0]?.outcome).toBe("assert_failed");
  });

  it("fails a see() assertion with the recorded probability", async () => {
    const oracle = new Oracle(
      new ScriptedClient({ answers: { a1: { type: "noul", noul: 0.05 } } }),
      DEFAULT_GATES,
      "iOS · app",
    );
    await expect(oracle.ask([{ intent: "the trip list screen", kind: "see" }], trips, "see")).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(AssertionFailedError);
        const message = (err as Error).message;
        expect(message).toContain('did not see "the trip list screen"');
        expect(message).toContain("yes 0.05");
        expect(message).toContain("Trip list");
        expect(message).not.toMatch(/noul|FAILED  see/);
        return true;
      },
    );
  });

  it("heuristic oracle accepts the trip list and rejects an error", async () => {
    const oracle = new Oracle(new HeuristicJevClient(), DEFAULT_GATES, "iOS · com.example.app");
    const result = await oracle.ask(
      [
        { intent: "the trip list screen", kind: "see" },
        { intent: "an error message", kind: "see.not" },
      ],
      trips,
      "see",
    );
    expect(result.hits[0]?.outcome).toBe("pass");
    expect(result.hits[1]?.outcome).toBe("pass");
  });

  it("classify asks a single Choice with none, not one noul per screen", async () => {
    let seen: JevRequest | undefined;
    const jev: JevClient = {
      async systemOne(request) {
        seen = request;
        return {
          answers: {
            screen: {
              type: "choice",
              choice: "s1",
              probabilities: { s0: 0.08, s1: 0.82, none: 0.1 },
            },
          },
        };
      },
    };
    const oracle = new Oracle(jev, DEFAULT_GATES, "iOS · app");
    const result = await oracle.classify(["a list of existing logins", "the home screen"], trips);
    expect(Object.keys(seen?.questions ?? {})).toEqual(["screen"]);
    expect(seen?.questions.screen?.type).toBe("choice");
    expect(seen?.questions.screen?.criteria).toMatchObject({
      s0: "a list of existing logins",
      s1: "the home screen",
      none: expect.stringMatching(/loading/i),
    });
    expect(seen?.state).toMatchObject({
      screen: {
        platform: "iOS · app",
        title: "Trip list",
        labels: ["Trip list", "Oakland to San Jose"],
      },
    });
    expect(result.target.choice).toBe("s1");
  });

  it("heuristic classify picks the trip list over login", async () => {
    const oracle = new Oracle(new HeuristicJevClient(), DEFAULT_GATES, "iOS · app");
    const result = await oracle.classify(["the login form", "the trip list"], trips);
    expect(result.target.choice).toBe("s1");
  });
});
