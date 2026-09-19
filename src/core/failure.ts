import { formatElement, type Element } from "./element.js";

export type FailureKind =
  | "not_found"
  | "ambiguous"
  | "assert_failed"
  | "timeout"
  | "driver"
  | "jev"
  | "config";

export interface FailureScore {
  label: string;
  p: number;
}

export interface FailureReport {
  kind: FailureKind;
  /** One-line headline. No ALL CAPS, no jargon. */
  title: string;
  action?: string;
  intent?: string;
  waitedMs?: number;
  scores?: FailureScore[];
  /** Visible control labels, already formatted (`[4] "Continue"`). */
  screen?: string[];
  hint: string;
  next?: string[];
  traceDir?: string;
  /** Truncated tool / HTTP output. */
  detail?: string;
}

const SCREEN_LIMIT = 12;
const DETAIL_LINES = 8;
const DETAIL_CHARS = 800;

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function screenRows(elements: Element[], limit = SCREEN_LIMIT): string[] {
  return elements.slice(0, limit).map((el) => formatElement(el));
}

export function formatScores(scores: FailureScore[]): string {
  return scores.map((s) => `${s.label} ${s.p.toFixed(2)}`).join("  ·  ");
}

export function formatFailure(report: FailureReport): string {
  const lines: string[] = [report.title, ""];
  if (report.waitedMs != null && report.waitedMs > 0) {
    lines.push(`  waited    ${formatDuration(report.waitedMs)}`);
  }
  if (report.scores?.length) {
    lines.push(`  scores    ${formatScores(report.scores)}`);
  }
  if (report.screen?.length) {
    lines.push("  on screen");
    for (const row of report.screen) lines.push(`    ${row}`);
  }
  if (report.detail?.trim()) {
    lines.push("  detail");
    for (const row of clipDetail(report.detail)) lines.push(`    ${row}`);
  }
  const next = [report.hint, ...(report.next ?? [])].filter((line) => line.trim().length > 0);
  if (next.length > 0) {
    lines.push(`  next      ${next[0]}`);
    for (const extra of next.slice(1)) lines.push(`            ${extra}`);
  }
  if (report.traceDir) lines.push(`  traces    ${report.traceDir}`);
  return lines.join("\n").replace(/\n+$/u, "");
}

export function mergeReport(base: FailureReport, extra: Partial<FailureReport>): FailureReport {
  const merged: FailureReport = {
    ...base,
    ...extra,
    scores: extra.scores ?? base.scores,
    screen: extra.screen ?? base.screen,
    next: extra.next ?? base.next,
    hint: extra.hint ?? base.hint,
  };
  const waited = extra.waitedMs ?? base.waitedMs;
  if (waited != null && waited >= 500 && (merged.kind === "not_found" || merged.kind === "assert_failed")) {
    merged.kind = "timeout";
    merged.waitedMs = waited;
    merged.hint = `waited ${formatDuration(waited)} and it never appeared — still loading, or the phrase does not match this UI`;
    merged.next = unique([
      ...(merged.next ?? []),
      "convoy inspect",
      "raise CONVOY_ACTION_TIMEOUT_MS if the app is slow",
    ]);
  }
  return merged;
}

export function clipDetail(text: string): string[] {
  const trimmed = text.replace(/\s+$/u, "");
  const lines = trimmed.split(/\r?\n/u).map((line) => line.trimEnd()).filter((line) => line.length > 0);
  const sliced = lines.slice(-DETAIL_LINES);
  const joined = sliced.join("\n");
  if (joined.length <= DETAIL_CHARS) return sliced;
  return [joined.slice(0, DETAIL_CHARS).trimEnd() + "…"];
}

export function toolReport(opts: {
  command: string;
  args?: string[];
  code?: number;
  stderr?: string;
  stdout?: string;
  title?: string;
  hint?: string;
}): FailureReport {
  const args = opts.args ?? [];
  const invoked = [opts.command, ...args].join(" ").trim();
  const output = (opts.stderr || opts.stdout || "").trim();
  const code = opts.code;
  const title =
    opts.title ??
    (code === undefined ? `${opts.command} failed` : `${invoked} failed (exit ${code})`);
  return {
    kind: "driver",
    title,
    action: opts.command,
    hint: opts.hint ?? hintForTool(opts.command, args, output),
    next: ["convoy doctor"],
    detail: output || undefined,
  };
}

export function jevHttpReport(status: number, body: string): FailureReport {
  const snippet = body.replace(/\s+/gu, " ").trim().slice(0, 240);
  const title = status === 401 || status === 403 ? "Jev rejected the API key" : `Jev HTTP ${status}`;
  const hint =
    status === 401 || status === 403
      ? "set TYPESAFE_API_KEY in .env (gitignored) or the CI secret store"
      : status === 429 || status === 529
        ? "rate limited — wait and retry, or check the TypeSafe quota"
        : "the Jev request failed — check TYPESAFE_BASE_URL and network, then convoy doctor";
  return {
    kind: "jev",
    title,
    hint,
    next: ["convoy doctor"],
    detail: snippet || undefined,
  };
}

export function rankedScores(probabilities: Record<string, number>, labels?: (id: string) => string): FailureScore[] {
  return Object.entries(probabilities)
    .map(([id, p]) => ({ label: labels?.(id) ?? id, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5);
}

function hintForTool(command: string, args: string[], output: string): string {
  const blob = `${command} ${args.join(" ")} ${output}`.toLowerCase();
  if (/not found|enoent|command not found/.test(blob)) {
    return `${command} is not installed or not on PATH`;
  }
  if (/timed out/.test(blob)) {
    return `${command} hung — check the simulator/emulator is responsive`;
  }
  if (/simctl boot|unable to boot/.test(blob)) {
    return "no bootable iPhone simulator, or CONVOY_IOS_UDID does not match a device Xcode can boot";
  }
  if (command === "idb") {
    return "idb failed talking to the simulator — convoy doctor, then confirm the UDID is booted";
  }
  if (command === "adb") {
    return "adb failed — start an emulator or attach a device, then convoy doctor";
  }
  return "the device/app command failed — convoy doctor, then retry";
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
