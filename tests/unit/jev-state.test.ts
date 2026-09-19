import { describe, expect, it } from "vitest";
import type { Element } from "../../src/core/element.js";
import { buildJevState, screenLabels, screenTitle } from "../../src/jev/state.js";

function el(
  id: string,
  role: Element["role"],
  name: string,
  bounds: Element["bounds"],
): Element {
  return { id, role, name, enabled: true, bounds, ref: {} };
}

describe("jev screen state", () => {
  it("sends unique labels in reading order and a top-of-screen title", () => {
    const elements = [
      el("e1", "button", "Back", [0.02, 0.06, 0.12, 0.05]),
      el("e2", "text", "Example App", [0.2, 0.08, 0.5, 0.05]),
      el("e3", "textfield", "Password", [0.08, 0.36, 0.84, 0.06]),
      el("e4", "button", "Log in", [0.25, 0.5, 0.5, 0.06]),
      el("e5", "button", "Log in", [0.25, 0.58, 0.5, 0.06]),
    ];
    expect(screenTitle(elements)).toBe("Example App");
    expect(screenLabels(elements)).toEqual(["Back", "Example App", "Password", "Log in"]);
    expect(buildJevState("iOS · com.example.app", elements).screen).toEqual({
      platform: "iOS · com.example.app",
      title: "Example App",
      labels: ["Back", "Example App", "Password", "Log in"],
    });
  });

  it("does not put field values into labels or elements by default", () => {
    const elements = [
      el("e1", "textfield", "Email / Username", [0.08, 0.28, 0.84, 0.06]),
    ];
    elements[0]!.value = "driver@example.com";
    expect(screenLabels(elements)).toEqual(["Email / Username"]);
    expect(JSON.stringify(buildJevState("iOS", elements))).not.toContain("driver@example.com");
    expect(JSON.stringify(buildJevState("iOS", elements, { includeValues: true }))).toContain(
      "driver@example.com",
    );
  });
});
