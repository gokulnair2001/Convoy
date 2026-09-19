import { describe, expect, it } from "vitest";
import { normalizeAndroid, normalizeIos, normalizeWeb } from "../../src/core/normalize.js";

const SCREEN = { x: 0, y: 0, width: 390, height: 844 };

function labelledControl(overrides: Record<string, unknown> = {}) {
  return {
    type: "Button",
    role_description: "button",
    AXLabel: "Sign in",
    enabled: true,
    frame: { x: 196, y: 612, width: 184, height: 48 },
    ...overrides,
  };
}

export function largeIosDump(): unknown[] {
  const nodes: unknown[] = [];
  for (let i = 0; i < 303; i += 1) {
    if (i % 3 === 0) {
      nodes.push({
        type: "Image",
        AXLabel: "",
        enabled: true,
        frame: { x: 10, y: 10 + (i % 20), width: 20, height: 20 },
      });
    } else if (i % 3 === 1) {
      nodes.push({
        type: "Button",
        AXLabel: `Offscreen ${i}`,
        enabled: true,
        frame: { x: -400, y: -400, width: 40, height: 20 },
      });
    } else {
      nodes.push({
        type: "Other",
        AXLabel: "Spacer",
        enabled: true,
        frame: { x: 0, y: 0, width: 0, height: 0 },
      });
    }
  }
  nodes.push(
    { type: "Button", AXLabel: "Back", enabled: true, frame: { x: 8, y: 50, width: 48, height: 32 } },
    { type: "TextField", AXLabel: "Email", AXValue: "", enabled: true, frame: { x: 24, y: 220, width: 340, height: 44 } },
    {
      type: "SecureTextField",
      AXLabel: "Password",
      AXValue: "",
      enabled: true,
      frame: { x: 24, y: 280, width: 340, height: 44 },
    },
    labelledControl(),
    { type: "Button", AXLabel: "Forgot password?", enabled: true, frame: { x: 80, y: 680, width: 230, height: 32 } },
    { type: "Link", AXLabel: "Create account", enabled: true, frame: { x: 100, y: 720, width: 190, height: 28 } },
    { type: "Button", AXLabel: "Use SSO", enabled: true, frame: { x: 80, y: 540, width: 230, height: 48 } },
    { type: "Button", role_description: "tab", AXLabel: "Home", enabled: true, frame: { x: 20, y: 790, width: 80, height: 48 } },
    {
      type: "Button",
      role_description: "tab",
      AXLabel: "Settings",
      enabled: true,
      frame: { x: 290, y: 790, width: 80, height: 48 },
    },
  );
  return nodes;
}

describe("normalizeIos", () => {
  it("reduces a 312-node dump to under 15 elements and keeps Sign in", () => {
    const dump = largeIosDump();
    expect(dump.length).toBe(312);
    const result = normalizeIos(dump, { screen: SCREEN });
    expect(result.dropped.total).toBeGreaterThanOrEqual(312);
    expect(result.elements.length).toBeLessThan(15);
    expect(result.elements.length).toBeGreaterThanOrEqual(8);
    const signin = result.elements.find((e) => e.name === "Sign in");
    expect(signin).toBeDefined();
    expect(signin?.role).toBe("button");
    expect(signin?.id).toMatch(/^e\d+$/);
  });

  it("maps nested idb trees and AXFrame strings", () => {
    const nested = {
      type: "Application",
      AXLabel: "Driver",
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        {
          type: "Window",
          AXLabel: "",
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [labelledControl({ AXFrame: "{{196, 612}, {184, 48}}", frame: undefined })],
        },
      ],
    };
    const result = normalizeIos(nested, { screen: SCREEN });
    expect(result.elements.some((e) => e.name === "Sign in")).toBe(true);
  });

  it("assigns stable top-to-bottom ids", () => {
    const result = normalizeIos(
      [
        { type: "Button", AXLabel: "Bottom", enabled: true, frame: { x: 10, y: 700, width: 80, height: 40 } },
        { type: "Button", AXLabel: "Top", enabled: true, frame: { x: 10, y: 40, width: 80, height: 40 } },
      ],
      { screen: SCREEN },
    );
    expect(result.elements.map((e) => e.name)).toEqual(["Top", "Bottom"]);
    expect(result.elements[0]?.id).toBe("e1");
  });

  it("keeps an unlabeled text field so type can clear and fill it", () => {
    const result = normalizeIos(
      [
        {
          type: "StaticText",
          AXLabel: "Email / Username",
          enabled: true,
          frame: { x: 24, y: 460, width: 340, height: 20 },
        },
        {
          type: "TextField",
          AXLabel: "",
          AXValue: "old@example.com",
          enabled: true,
          frame: { x: 24, y: 480, width: 340, height: 44 },
        },
      ],
      { screen: SCREEN },
    );
    const field = result.elements.find((e) => e.role === "textfield");
    expect(field).toBeDefined();
    expect(field?.name).toBe("text field");
    expect(field?.value).toBe("old@example.com");
  });
});

describe("normalizeAndroid", () => {
  it("parses a uiautomator XML dump", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" enabled="true">
    <node class="android.widget.Button" text="Sign in" content-desc="" bounds="[200,1600][880,1720]" enabled="true"/>
    <node class="android.widget.EditText" text="" content-desc="Email" bounds="[80,800][1000,920]" enabled="true"/>
    <node class="android.widget.TextView" text="" bounds="[0,0][10,10]" enabled="true"/>
  </node>
</hierarchy>`;
    const result = normalizeAndroid(xml, { screen: { x: 0, y: 0, width: 1080, height: 2400 } });
    expect(result.elements.find((e) => e.name === "Sign in")?.role).toBe("button");
    expect(result.elements.find((e) => e.name === "Email")?.role).toBe("textfield");
  });
});

describe("normalizeWeb", () => {
  it("maps roles from a Playwright-style dump", () => {
    const result = normalizeWeb(
      [
        { role: "button", name: "Sign in", frame: { x: 100, y: 400, width: 200, height: 40 }, enabled: true },
        { tag: "input", type: "email", name: "Email", frame: { x: 100, y: 200, width: 300, height: 40 } },
        { tag: "a", name: "Create account", frame: { x: 100, y: 500, width: 200, height: 24 } },
      ],
      { screen: { x: 0, y: 0, width: 1440, height: 900 } },
    );
    expect(result.elements.map((e) => `${e.role}:${e.name}`)).toEqual(
      expect.arrayContaining(["button:Sign in", "textfield:Email", "link:Create account"]),
    );
  });
});
