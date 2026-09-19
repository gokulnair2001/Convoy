import { spawn, type ChildProcess } from "node:child_process";
import type { ConvoyConfig } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { formatDuration } from "../core/failure.js";
import { expandEnv } from "../util/expand.js";
import { sleep } from "../util/sleep.js";
import type { LifecycleLogger } from "./logger.js";
import type { LifecycleDeps, PrepareResult } from "./prepare.js";

let webServer: ChildProcess | undefined;
let exitHooked = false;

export async function prepareWeb(
  config: ConvoyConfig,
  log: LifecycleLogger,
  deps: LifecycleDeps = {},
): Promise<PrepareResult> {
  const command = config.web.server?.command;
  if (!command) {
    return { skipped: true, platform: "web", detail: "no server" };
  }

  const url = config.web.server?.url ?? config.web.baseUrl;
  const timeoutMs = config.web.server?.timeoutMs ?? 60_000;

  if (webServer && !webServer.killed) {
    return { skipped: false, platform: "web", detail: url };
  }

  log.phase("starting web server…");
  const started = Date.now();
  const spawnFn = deps.spawn ?? spawn;
  const child = spawnFn("sh", ["-c", expandEnv(command)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  webServer = child;
  hookExit();
  child.stdout?.resume();
  child.stderr?.resume();

  child.on("error", () => {
    if (webServer === child) webServer = undefined;
  });

  log.phase(`waiting for ${url}…`);
  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    await waitUntilHttp(url, timeoutMs, fetchFn, () => Boolean(child.exitCode !== null));
  } catch (err) {
    stopWebServer();
    throw err;
  }
  log.done("web server ready", Date.now() - started);
  return { skipped: false, platform: "web", detail: url };
}

export function stopWebServer(): void {
  const child = webServer;
  webServer = undefined;
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

async function waitUntilHttp(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
  exited: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    if (exited()) {
      throw new ToolError({
        kind: "driver",
        title: `web server exited before becoming ready at ${url}`,
        hint: "the process died — check web.server.command and the port",
        next: ["convoy doctor"],
      });
    }
    try {
      await fetchFn(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await sleep(250);
    }
  }
  throw new ToolError({
    kind: "timeout",
    title: `timed out waiting for ${url}`,
    waitedMs: timeoutMs,
    hint: `no HTTP response after ${formatDuration(timeoutMs)}`,
    detail: last,
    next: ["check web.server.command and CONVOY_WEB_BASE_URL"],
  });
}

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => {
    if (webServer && !webServer.killed) webServer.kill("SIGTERM");
  });
}
