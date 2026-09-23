import { describe, expect, it } from "vitest";
import { applyRunSessionFlags } from "../../src/cli/run.js";
import { defaultConfig } from "../../src/core/config.js";

describe("applyRunSessionFlags", () => {
  it("reuse attaches and disables install+launch", () => {
    const config = defaultConfig();
    const result = applyRunSessionFlags(config, { reuse: true });
    expect(result).toEqual({ ok: true });
    expect(config.sessionStart).toBe("attach");
    expect(config.sessionStartLocked).toBe(true);
    expect(config.lifecycle.install).toBe(false);
    expect(config.lifecycle.launch).toBe(false);
  });

  it("restart locks launch without disabling install or launch", () => {
    const config = defaultConfig();
    const result = applyRunSessionFlags(config, { restart: true });
    expect(result).toEqual({ ok: true });
    expect(config.sessionStart).toBe("launch");
    expect(config.sessionStartLocked).toBe(true);
    expect(config.lifecycle.install).toBe(true);
    expect(config.lifecycle.launch).toBe(true);
  });

  it("restart does not force install or launch on", () => {
    const config = defaultConfig();
    config.lifecycle.install = false;
    config.lifecycle.launch = false;
    applyRunSessionFlags(config, { restart: true });
    expect(config.sessionStart).toBe("launch");
    expect(config.sessionStartLocked).toBe(true);
    expect(config.lifecycle.install).toBe(false);
    expect(config.lifecycle.launch).toBe(false);
  });

  it("errors when reuse and restart are both set", () => {
    const config = defaultConfig();
    const snapshot = structuredClone(config);
    const result = applyRunSessionFlags(config, { reuse: true, restart: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected mutually exclusive flags to fail");
    expect(result.message).toMatch(/--reuse and --restart cannot be used together/);
    expect(config).toEqual(snapshot);
  });

  it("leaves config unchanged when neither flag is set", () => {
    const config = defaultConfig();
    const result = applyRunSessionFlags(config, {});
    expect(result).toEqual({ ok: true });
    expect(config.sessionStart).toBe("launch");
    expect(config.sessionStartLocked).toBe(false);
    expect(config.lifecycle.install).toBe(true);
    expect(config.lifecycle.launch).toBe(true);
  });
});
