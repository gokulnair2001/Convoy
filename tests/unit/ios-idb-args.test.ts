import { describe, expect, it } from "vitest";
import { idbArgs } from "../../src/drivers/ios.js";

describe("idbArgs", () => {
  it("puts --udid after the subcommand", () => {
    expect(idbArgs(["ui", "describe-all", "--nested"], "ABC")).toEqual([
      "ui",
      "describe-all",
      "--nested",
      "--udid",
      "ABC",
    ]);
  });

  it("leaves args unchanged when no udid is set", () => {
    expect(idbArgs(["ui", "tap", "10", "20"])).toEqual(["ui", "tap", "10", "20"]);
  });
});
