import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/core/errors.js";
import { waitUntil } from "../../src/core/settle.js";

describe("waitUntil", () => {
  it("retries retryable errors until the fn succeeds", async () => {
    let n = 0;
    const value = await waitUntil(
      async () => {
        n += 1;
        if (n < 3) {
          throw new NotFoundError({
            kind: "not_found",
            title: "not yet",
            hint: "retry",
          });
        }
        return "ok";
      },
      (err) => err instanceof NotFoundError,
      { timeoutMs: 2_000, intervalMs: 10 },
    );
    expect(value).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    await expect(
      waitUntil(
        async () => {
          throw new Error("boom");
        },
        (err) => err instanceof NotFoundError,
        { timeoutMs: 1_000, intervalMs: 10 },
      ),
    ).rejects.toThrow("boom");
  });
});
