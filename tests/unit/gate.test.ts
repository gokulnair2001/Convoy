import { describe, expect, it } from "vitest";
import { DEFAULT_GATES, gateAssert, gateResolve, gateWhich } from "../../src/core/gate.js";

describe("gateResolve", () => {
  it("passes when presence, none, and target all clear the thresholds", () => {
    const decision = gateResolve({
      present: 0.98,
      target: {
        choice: "e4",
        probabilities: { e4: 0.93, e7: 0.04, none: 0.01 },
      },
    });
    expect(decision).toEqual({ outcome: "pass", elementId: "e4" });
  });

  it("returns not_found when the control is absent", () => {
    const decision = gateResolve({
      present: 0.12,
      target: {
        choice: "none",
        probabilities: { e4: 0.05, none: 0.9 },
      },
    });
    expect(decision.outcome).toBe("not_found");
  });

  it("returns not_found when none probability is elevated", () => {
    const decision = gateResolve({
      present: 0.95,
      target: {
        choice: "e4",
        probabilities: { e4: 0.8, none: 0.2 },
      },
    });
    expect(decision.outcome).toBe("not_found");
  });

  it("returns ambiguous when the top two options are too close", () => {
    const decision = gateResolve({
      present: 0.96,
      target: {
        choice: "e4",
        probabilities: { e4: 0.48, e9: 0.44, none: 0.02 },
      },
    });
    expect(decision.outcome).toBe("ambiguous");
    if (decision.outcome === "ambiguous") {
      expect(decision.top[0]?.id).toBe("e4");
      expect(decision.top[1]?.id).toBe("e9");
    }
  });

  it("passes a clear Choice even when present noul is below 0.90", () => {
    const decision = gateResolve({
      present: 0.71,
      target: {
        choice: "e3",
        probabilities: { e3: 0.99, e1: 0, e2: 0, none: 0.01 },
      },
    });
    expect(decision).toEqual({ outcome: "pass", elementId: "e3" });
  });

  it("passes a clear winner even when target is below 0.75 if the gap is wide", () => {
    const decision = gateResolve({
      present: 0.97,
      target: {
        choice: "e2",
        probabilities: { e2: 0.62, e3: 0.2, none: 0.03 },
      },
    });
    expect(decision).toEqual({ outcome: "pass", elementId: "e2" });
  });

  it("see drops a weak winner instead of taking the best of a bad lot", () => {
    const decision = gateResolve(
      {
        present: 1,
        target: {
          choice: "e2",
          probabilities: { e2: 0.47, e4: 0.08, none: 0.08 },
        },
      },
      DEFAULT_GATES,
      { strictTarget: true },
    );
    expect(decision.outcome).toBe("not_found");
  });

  it("see still passes a clear element above the target gate", () => {
    const decision = gateResolve(
      {
        present: 1,
        target: {
          choice: "e4",
          probabilities: { e4: 0.88, e2: 0.05, none: 0.04 },
        },
      },
      DEFAULT_GATES,
      { strictTarget: true },
    );
    expect(decision).toEqual({ outcome: "pass", elementId: "e4" });
  });
});

describe("gateWhich", () => {
  it("retries while none is the most likely screen", () => {
    const decision = gateWhich({
      choice: "none",
      probabilities: { s0: 0.12, s1: 0.08, none: 0.8 },
    });
    expect(decision.outcome).toBe("not_found");
  });

  it("picks a 0.7 vs 0.2 split that dual-noul would have rejected", () => {
    const decision = gateWhich({
      choice: "s0",
      probabilities: { s0: 0.7, s1: 0.2, none: 0.1 },
    });
    expect(decision).toEqual({ outcome: "pass", optionId: "s0" });
  });

  it("does not let a small none mass veto a clear screen", () => {
    const decision = gateWhich({
      choice: "s1",
      probabilities: { s0: 0.08, s1: 0.78, none: 0.14 },
    });
    expect(decision).toEqual({ outcome: "pass", optionId: "s1" });
  });

  it("returns ambiguous when two screens are too close", () => {
    const decision = gateWhich({
      choice: "s0",
      probabilities: { s0: 0.48, s1: 0.44, none: 0.08 },
    });
    expect(decision.outcome).toBe("ambiguous");
  });
});

describe("gateAssert", () => {
  it("accepts a high noul for see()", () => {
    expect(gateAssert("see", 0.96).outcome).toBe("pass");
  });

  it("fails see() when the condition is clearly false", () => {
    const d = gateAssert("see", 0.04);
    expect(d.outcome).toBe("assert_failed");
  });

  it("treats a noul near 0.5 as ambiguous, not partial truth", () => {
    expect(gateAssert("see", 0.51).outcome).toBe("ambiguous");
    expect(gateAssert("see.not", 0.49).outcome).toBe("ambiguous");
  });

  it("accepts a low noul for see.not()", () => {
    expect(gateAssert("see.not", 0.04).outcome).toBe("pass");
  });

  it("fails see.not() when the condition is clearly true", () => {
    expect(gateAssert("see.not", 0.96).outcome).toBe("assert_failed");
  });

  it("uses min for score()", () => {
    expect(gateAssert("score", 0.9, DEFAULT_GATES, 0.8).outcome).toBe("pass");
    expect(gateAssert("score", 0.4, DEFAULT_GATES, 0.8).outcome).toBe("assert_failed");
  });
});
