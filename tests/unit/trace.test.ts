import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Tracer } from "../../src/core/trace.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "convoy-trace-"));
  dirs.push(dir);
  return dir;
}

describe("Tracer", () => {
  it("recordStep without screenshot does not write screen.png", async () => {
    const tracer = new Tracer(await tmpRoot(), "ios", "no screenshot");
    await tracer.begin();
    const stepDir = await tracer.recordStep({
      action: "see",
      outcome: "pass",
      ms: 1,
      elements: [],
    });
    await expect(access(path.join(stepDir, "screen.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("attachScreenshotToLast writes screen.png into the last step dir", async () => {
    const tracer = new Tracer(await tmpRoot(), "ios", "attach last");
    await tracer.begin();
    const stepDir = await tracer.recordStep({
      action: "tap",
      outcome: "pass",
      ms: 2,
      elements: [],
    });
    const png = Buffer.from("last-step-png");
    await tracer.attachScreenshotToLast(png);
    expect(await readFile(path.join(stepDir, "screen.png"))).toEqual(png);
  });

  it("recordStep writes screen.png when a screenshot is provided", async () => {
    const tracer = new Tracer(await tmpRoot(), "ios", "failure screenshot");
    await tracer.begin();
    const png = Buffer.from("fail-png");
    const stepDir = await tracer.recordStep({
      action: "which",
      outcome: "not_found",
      ms: 3,
      elements: [],
      screenshot: png,
    });
    expect(await readFile(path.join(stepDir, "screen.png"))).toEqual(png);
  });
});
