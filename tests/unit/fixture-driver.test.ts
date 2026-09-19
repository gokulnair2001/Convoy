import { describe, expect, it } from "vitest";
import { FixtureDriver } from "../../src/drivers/fixture.js";
import type { FixtureScript } from "../../src/drivers/fixture.js";

const script: FixtureScript = {
  emulatePlatform: "ios",
  initial: "landing",
  screens: [
    {
      name: "landing",
      elements: [
        { id: "e1", role: "button", name: "Sign in", enabled: true, bounds: [0.2, 0.7, 0.5, 0.06], ref: {} },
      ],
    },
    {
      name: "login",
      elements: [
        { id: "e1", role: "textfield", name: "Email", enabled: true, bounds: [0.1, 0.3, 0.8, 0.06], ref: {} },
      ],
    },
  ],
  transitions: [{ from: "landing", tapName: "Sign in", to: "login" }],
};

describe("FixtureDriver", () => {
  it("replays snapshots and advances on matching taps", async () => {
    const driver = new FixtureDriver(script);
    const first = await driver.snapshot();
    expect(first.map((e) => e.name)).toEqual(["Sign in"]);
    await driver.tap(first[0]!);
    const second = await driver.snapshot();
    expect(second.map((e) => e.name)).toEqual(["Email"]);
  });

  it("replaces existing textfield value instead of appending", async () => {
    const driver = new FixtureDriver(script);
    await driver.tap((await driver.snapshot())[0]!);
    const email = (await driver.snapshot())[0]!;
    await driver.type(email, "old@example.com");
    await driver.type(email, "new@example.com");
    expect((await driver.snapshot())[0]?.value).toBe("new@example.com");
  });

  it("types into a textfield and reset restores the initial screen", async () => {
    const driver = new FixtureDriver(script);
    await driver.tap((await driver.snapshot())[0]!);
    const email = (await driver.snapshot())[0]!;
    await driver.type(email, "test@example.com");
    expect((await driver.snapshot())[0]?.value).toBe("test@example.com");
    await driver.reset();
    expect(driver.screenName).toBe("landing");
  });

  it("loads the signin fixture from disk", async () => {
    const driver = await FixtureDriver.fromFile("tests/fixtures/signin.json");
    const landing = await driver.snapshot();
    expect(landing.some((e) => e.name === "Sign in")).toBe(true);
  });
});
