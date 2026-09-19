import { describe, expect, it } from "vitest";
import { expandEnv } from "../../src/util/expand.js";

describe("expandEnv", () => {
  it("substitutes ${NAME} from the env map and leaves unknown tokens", () => {
    const out = expandEnv("id=${CONVOY_IOS_UDID} cmd=${MISSING}", {
      CONVOY_IOS_UDID: "ABC-123",
    });
    expect(out).toBe("id=ABC-123 cmd=${MISSING}");
  });
});
