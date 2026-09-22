import { describe, expect, it } from "vitest";
import { bannerFromConfig, heuristicFallbackWarning } from "../../src/cli/run.js";
import { applyEnv, defaultConfig } from "../../src/core/config.js";
import { Reporter, type RunBanner } from "../../src/runner/reporter.js";

const ANSI = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replace(ANSI, "");
}

function capture(): { lines: string[]; write: (line: string) => void; text: () => string } {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
    text: () => strip(lines.join("\n")),
  };
}

const banner: RunBanner = {
  version: "0.1.0",
  platform: "ios",
  device: "iPhone (UDID-1)",
  app: "Example App  com.example.app",
  jev: "live · jev-latest",
  tracesDir: ".convoy/runs/2026-09-19T14-22-01",
  headed: true,
};

describe("reporter", () => {
  it("prints a headed banner without leaking API keys", () => {
    const { write, text } = capture();
    const reporter = new Reporter(false, write);
    reporter.banner({
      ...banner,
      jev: "live · jev-latest · debug",
    });
    const out = text();
    expect(out).toContain("CONVOY");
    expect(out).toContain("semantic e2e · 0.1.0");
    expect(out).toContain("/ ____/___");
    expect(out).toMatch(/platform\s+ios · iPhone \(UDID-1\)/);
    expect(out).toContain("Example App  com.example.app");
    expect(out).toContain("live · jev-latest · debug");
    expect(out).toContain(".convoy/runs/2026-09-19T14-22-01");
    expect(out).not.toMatch(/TYPESAFE_API_KEY|sk-|api[_-]?key/i);
    expect(out).not.toContain("secret");
  });

  it("never puts an API key on the banner built from config", () => {
    const config = applyEnv(defaultConfig(), {
      TYPESAFE_API_KEY: "sk-live-SUPERSECRET",
      CONVOY_JEV_MODE: "live",
    });
    const info = bannerFromConfig(config, true);
    expect(JSON.stringify(info)).not.toContain("SUPERSECRET");
    expect(info.jev).toBe("live · jev-latest");
    const { write, text } = capture();
    new Reporter(false, write).banner(info);
    expect(text()).not.toContain("SUPERSECRET");
    expect(text()).not.toContain("sk-live");
  });

  it("prints only the platform line when silent", () => {
    const { write, text } = capture();
    const reporter = new Reporter(true, write);
    reporter.banner(banner);
    const out = text();
    expect(out).toMatch(/platform\s+ios · iPhone \(UDID-1\)/);
    expect(out).not.toContain("CONVOY");
    expect(out).not.toContain("semantic e2e");
    expect(out).not.toContain("/ ____/");
    expect(out).not.toContain("Example App");
    expect(out).not.toContain("jev");
  });

  it("prints phase, done, and warn", () => {
    const { write, text } = capture();
    const reporter = new Reporter(false, write);
    reporter.phase("booting simulator");
    reporter.done("simulator ready", 1200);
    reporter.warn("idb not found");
    const out = text();
    expect(out).toContain("↻  booting simulator");
    expect(out).toMatch(/✓ {2}simulator ready\s+1\.2s/);
    expect(out).toContain("⚠  idb not found");
  });

  it("skips phase and done when silent but still warns", () => {
    const { write, text } = capture();
    const reporter = new Reporter(true, write);
    reporter.phase("booting simulator");
    reporter.done("simulator ready", 40);
    reporter.warn("no apk on disk");
    const out = text();
    expect(out).not.toContain("booting simulator");
    expect(out).not.toContain("simulator ready");
    expect(out).toContain("⚠  no apk on disk");
  });

  it("prints a summary with traces", () => {
    const { write, text } = capture();
    const reporter = new Reporter(true, write);
    reporter.summary({
      passed: 1,
      failed: 0,
      durationMs: 1500,
      tracesDir: ".convoy/runs/abc",
    });
    const out = text();
    expect(out).toMatch(/✓ {2}1 passed {2}0 failed {2}1\.5s/);
    expect(out).toContain("traces  .convoy/runs/abc");
  });

  it("prints a failed summary and a traces hint after fail()", () => {
    const { write, text } = capture();
    const reporter = new Reporter(true, write);
    reporter.fail(
      "sign in",
      "tests/signin.e2e.ts",
      [
        'could not tap "Log in"',
        "",
        "  scores    none 0.90  ·  present 0.08",
        "  next      that control is not on this screen",
        "  traces    .convoy/runs/fail-1",
      ].join("\n"),
    );
    reporter.summary({
      passed: 0,
      failed: 1,
      durationMs: 80,
      tracesDir: ".convoy/runs/fail-1",
    });
    const out = text();
    expect(out).toContain("✗  sign in");
    expect(out).toContain("tests/signin.e2e.ts");
    expect(out).toContain('could not tap "Log in"');
    expect(out).toContain("traces    .convoy/runs/fail-1");
    expect(out).not.toContain("NOT FOUND");
    expect(out).toMatch(/✗ {2}0 passed {2}1 failed {2}80ms/);
  });

  it("groups actions under a bold test name", () => {
    const { write, text } = capture();
    const reporter = new Reporter(false, write);
    reporter.beginTest("signs in with email");
    const out = text();
    expect(out.startsWith("\nsigns in with email")).toBe(true);
  });

  it("warns when a device run has no API key and is on heuristic", () => {
    const ios = applyEnv(defaultConfig(), { CONVOY_PLATFORM: "ios" });
    expect(ios.jev.mode).toBe("heuristic");
    expect(heuristicFallbackWarning(ios)).toMatch(/TYPESAFE_API_KEY is not set/);

    const withKey = applyEnv(defaultConfig(), {
      CONVOY_PLATFORM: "ios",
      TYPESAFE_API_KEY: "sk-live-test",
    });
    expect(heuristicFallbackWarning(withKey)).toBeUndefined();

    const fixture = defaultConfig();
    expect(fixture.platform).toBe("fixture");
    expect(heuristicFallbackWarning(fixture)).toBeUndefined();
  });

  it("does not warn when heuristic is explicit but a key is present", () => {
    const config = applyEnv(defaultConfig(), {
      CONVOY_PLATFORM: "android",
      TYPESAFE_API_KEY: "sk-live-test",
      CONVOY_JEV_MODE: "heuristic",
    });
    expect(heuristicFallbackWarning(config)).toBeUndefined();
  });
});
