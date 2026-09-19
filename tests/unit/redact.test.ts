import { describe, expect, it } from "vitest";
import { redactEnv, redactValue } from "../../src/util/redact.js";

describe("redact", () => {
  it("hides API keys, passwords, secrets, and tokens", () => {
    expect(redactValue("TYPESAFE_API_KEY", "sk-live-abcdef")).toBe("sk…ef");
    expect(redactValue("password", "hunter2")).toBe("hu…r2");
    expect(redactValue("secret", "abcd")).toBe("****");
    expect(redactValue("auth_token", "tokensecret")).toBe("to…et");
  });

  it("leaves non-secret values intact and marks missing ones", () => {
    expect(redactValue("platform", "ios")).toBe("ios");
    expect(redactValue("device", "iPhone (UDID-1)")).toBe("iPhone (UDID-1)");
    expect(redactValue("TYPESAFE_API_KEY", undefined)).toBe("(unset)");
  });

  it("redacts only CONVOY_ and TYPESAFE_ env keys", () => {
    const out = redactEnv({
      CONVOY_PLATFORM: "ios",
      TYPESAFE_API_KEY: "sk-live-abcdef",
      PATH: "/usr/bin",
      HOME: "/tmp",
    });
    expect(out.CONVOY_PLATFORM).toBe("ios");
    expect(out.TYPESAFE_API_KEY).toBe("sk…ef");
    expect(out.PATH).toBeUndefined();
    expect(out.HOME).toBeUndefined();
  });
});
