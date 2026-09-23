import { describe, expect, it } from "vitest";
import type { Element } from "../../src/core/element.js";
import { NotFoundError } from "../../src/core/errors.js";
import { signature, waitUntilPresent } from "../../src/core/settle.js";

function el(partial: Partial<Element> & Pick<Element, "name">): Element {
  return {
    id: partial.id ?? "e1",
    role: partial.role ?? "button",
    name: partial.name,
    value: partial.value,
    enabled: partial.enabled ?? true,
    bounds: partial.bounds ?? [0, 0, 0.2, 0.05],
    ref: {},
  };
}

describe("signature", () => {
  it("differs when only enabled flips", () => {
    const disabled = signature([el({ name: "Continue", enabled: false })]);
    const enabled = signature([el({ name: "Continue", enabled: true })]);
    expect(disabled).not.toBe(enabled);
  });
});

describe("waitUntilPresent", () => {
  it("skips attempt when the tree signature is unchanged after a retryable miss", async () => {
    const treeA = [el({ name: "Continue", enabled: false })];
    const treeB = [el({ name: "Continue", enabled: true })];
    const dumps = [treeA, treeA, treeB];
    let snapshots = 0;
    let attempts = 0;
    const started = Date.now();

    const value = await waitUntilPresent(
      async () => dumps[Math.min(snapshots++, dumps.length - 1)]!,
      async (elements) => {
        attempts += 1;
        if (signature(elements) === signature(treeA)) {
          throw new NotFoundError({
            kind: "not_found",
            title: "not yet",
            hint: "retry",
          });
        }
        return "ok";
      },
      (err) => err instanceof NotFoundError,
      { timeoutMs: 150 },
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(2);
    expect(snapshots).toBe(3);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("returns on the first dump without retrying", async () => {
    let snapshots = 0;
    let attempts = 0;

    const value = await waitUntilPresent(
      async () => {
        snapshots += 1;
        return [el({ name: "Continue" })];
      },
      async () => {
        attempts += 1;
        return "ok";
      },
      (err) => err instanceof NotFoundError,
      { timeoutMs: 150 },
    );

    expect(value).toBe("ok");
    expect(snapshots).toBe(1);
    expect(attempts).toBe(1);
  });
});
