import { describe, expect, it } from "vitest";
import { runDoctor } from "../../src/cli/doctor.js";

describe("doctor", () => {
  it("passes required checks on a clean machine", async () => {
    const checks = await runDoctor();
    const required = checks.filter((c) => c.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.every((c) => c.ok)).toBe(true);
    expect(checks.some((c) => c.name === "Node.js")).toBe(true);
    expect(checks.some((c) => c.name === "fixture")).toBe(true);
    expect(checks.some((c) => c.name === "platform")).toBe(true);
    expect(checks.find((c) => c.name === "idb")?.required).toBe(false);
    expect(checks.find((c) => c.name === "adb")?.required).toBe(false);
  });
});
