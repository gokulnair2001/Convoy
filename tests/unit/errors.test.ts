import { describe, expect, it } from "vitest";
import { throwResolve } from "../../src/core/gate.js";
import { AmbiguousError, NotFoundError, ToolError } from "../../src/core/errors.js";
import { formatFailure, mergeReport, toolReport, type FailureReport } from "../../src/core/failure.js";
import type { Element } from "../../src/core/element.js";

const elements: Element[] = [
  { id: "e4", role: "button", name: "Continue", enabled: true, bounds: [0, 0, 0.4, 0.06], ref: {} },
  { id: "e9", role: "button", name: "Continue as guest", enabled: true, bounds: [0.5, 0, 0.4, 0.06], ref: {} },
];

describe("failure reporting", () => {
  it("formats ambiguous with both controls, scores, and a next step", () => {
    try {
      throwResolve(
        {
          outcome: "ambiguous",
          reason: "gap",
          top: [
            { id: "e4", p: 0.48 },
            { id: "e9", p: 0.44 },
          ],
        },
        elements,
        `"continue"`,
        `tap "continue"`,
        ".convoy/runs/2026-09-19T14-22-01",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousError);
      const message = (err as Error).message;
      expect(message).toContain('could not tap "continue" — two controls match');
      expect(message).toContain('[4] "Continue"');
      expect(message).toContain('[9] "Continue as guest"');
      expect(message).toContain("0.48");
      expect(message).toContain("0.44");
      expect(message).toContain("rephrase so only one control matches");
      expect(message).toContain("  next\n    rephrase so only one control matches");
      expect(message).toContain("convoy inspect");
      expect(message).toContain("traces    .convoy/runs/2026-09-19T14-22-01");
      expect(message).toContain("█");
      expect(message).toMatch(/\[4] "Continue"\s+←/);
      expect(message).not.toMatch(/AMBIGUOUS|noul|disambiguate/);
      expect(Object.keys(err as object)).not.toContain("report");
    }
  });

  it("formats not-found with on-screen labels instead of jargon", () => {
    try {
      throwResolve(
        { outcome: "not_found", reason: "present 0.08 (need > 0.90), none 0.90 (need < 0.10)" },
        elements,
        `"the invoice button"`,
        `tap "the invoice button"`,
        ".convoy/runs/demo",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      const message = (err as Error).message;
      expect(message).toContain('could not tap "the invoice button"');
      expect(message).toContain("present");
      expect(message).toContain("0.08");
      expect(message).toContain("none");
      expect(message).toContain("0.90");
      expect(message).toContain('[4] "Continue"');
      expect(message).toContain("not on this screen");
      expect(message).toContain("traces    .convoy/runs/demo");
      expect(message).not.toMatch(/NOT FOUND|likely a real bug|noul/);
    }
  });

  it("turns a long wait into a timeout hint", () => {
    const report: FailureReport = {
      kind: "not_found",
      title: 'could not tap "Log in"',
      hint: "that control is not on this screen",
      next: ["convoy inspect"],
    };
    const timed = mergeReport(report, { waitedMs: 20_000 });
    expect(timed.kind).toBe("timeout");
    const text = formatFailure(timed);
    expect(text).toContain("waited    20s");
    expect(text).toMatch(/waited 20s and it never appeared/);
    expect(text).toContain("CONVOY_ACTION_TIMEOUT_MS");
  });

  it("formats a failed device command with truncated stderr and doctor", () => {
    const err = new ToolError(
      toolReport({
        command: "idb",
        args: ["launch", "com.example.app"],
        code: 1,
        stderr: "The operation couldn’t be completed.\nUnderlying error: Connection refused\n",
      }),
    );
    expect(err.message).toContain("idb launch com.example.app failed (exit 1)");
    expect(err.message).toContain("Connection refused");
    expect(err.message).toContain("convoy doctor");
    expect(err.message).not.toMatch(/NOT FOUND|noul/);
  });
});
