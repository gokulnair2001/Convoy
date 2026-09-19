import pc from "picocolors";
import { formatElement, type Element } from "../core/element.js";
import { formatDuration } from "../core/failure.js";
import type { LifecycleLogger } from "../lifecycle/logger.js";
import { redactValue } from "../util/redact.js";

export interface RunBanner {
  version: string;
  platform: string;
  device: string;
  app: string;
  jev: string;
  tracesDir: string;
  headed: boolean;
}

export interface RunSummary {
  passed: number;
  failed: number;
  durationMs: number;
  tracesDir: string;
}

/**
 * CLI output for a run. Implements LifecycleLogger so prepareEnvironment can
 * reuse the same phase / done / warn lines.
 */
export class Reporter implements LifecycleLogger {
  constructor(
    private readonly silent = false,
    private readonly write?: (line: string) => void,
  ) {}

  banner(info: RunBanner): void {
    const platformLine = `  ${padLabel("platform")} ${info.platform} · ${redactValue("device", info.device)}`;
    if (this.silent) {
      this.out(platformLine);
      return;
    }
    this.out(`${pc.bold("Convoy")}  ${info.version}`);
    this.out(platformLine);
    this.out(`  ${padLabel("app")} ${redactValue("app", info.app)}`);
    this.out(`  ${padLabel("jev")} ${redactValue("jev", info.jev)}`);
    this.out(`  ${padLabel("traces")} ${redactValue("tracesDir", info.tracesDir)}`);
    this.out("");
  }

  phase(label: string): void {
    if (this.silent) return;
    this.out(pc.dim(`↻  ${label}`));
  }

  done(label: string, ms?: number): void {
    if (this.silent) return;
    const duration = ms !== undefined ? pc.dim(`  ${formatDuration(ms)}`) : "";
    this.out(`${pc.green("✓")}  ${label}${duration}`);
  }

  warn(label: string): void {
    this.out(pc.yellow(`⚠  ${label}`));
  }

  beginTest(name: string): void {
    if (this.silent) return;
    this.out("");
    this.out(pc.bold(name));
  }

  summary(stats: RunSummary): void {
    const duration = formatDuration(stats.durationMs);
    const counts = `${stats.passed} passed  ${stats.failed} failed  ${duration}`;
    this.out("");
    if (stats.failed > 0) {
      this.out(pc.red(`✗  ${counts}`));
    } else {
      this.out(pc.green(`✓  ${counts}`));
    }
    this.out(pc.dim(`   traces  ${stats.tracesDir}`));
  }

  tap(intent: string, el: Element, probability: number, ms: number): void {
    this.line("tap", intent, `${formatElement(el).padEnd(22)} ${probability.toFixed(2).padStart(4)}   ${ms}ms`);
  }

  type(text: string, el: Element, probability: number, ms: number): void {
    this.line("type", text, `${formatElement(el).padEnd(22)} ${probability.toFixed(2).padStart(4)}   ${ms}ms`);
  }

  see(intent: string, probability: number, negated = false): void {
    const verb = negated ? "see.not" : "see";
    this.ok(`${verb.padEnd(4)} "${intent}"`.padEnd(36) + `${probability.toFixed(2)}`);
  }

  score(intent: string, value: number): void {
    this.ok(`${"score".padEnd(4)} "${intent}"`.padEnd(36) + `${value.toFixed(2)}`);
  }

  which(intent: string, probability: number): void {
    this.ok(`${"which".padEnd(4)} "${intent}"`.padEnd(36) + `${probability.toFixed(2)}`);
  }

  settling(): void {
    if (this.silent) return;
    this.out(pc.dim("⏳ waiting for screen to settle…"));
  }

  fail(testName: string, file: string, message: string): void {
    this.err("");
    this.err(`${pc.red("✗")}  ${pc.bold(testName)}`);
    this.err(pc.dim(`   ${file}`));
    this.err("");
    for (const line of message.split("\n")) {
      this.err(colorFailureLine(line));
    }
    this.err("");
  }

  pass(testName: string): void {
    if (this.silent) return;
    this.out(pc.green(`✓ ${testName}`));
  }

  private line(verb: string, intent: string, rest: string): void {
    if (this.silent) return;
    this.out(`${pc.cyan("▶")} ${verb.padEnd(4)} ${JSON.stringify(intent).padEnd(24)} → ${rest}`);
  }

  private ok(rest: string): void {
    if (this.silent) return;
    this.out(`${pc.green("✓")} ${rest}`);
  }

  private out(line: string): void {
    if (this.write) {
      this.write(line);
      return;
    }
    console.log(line);
  }

  private err(line: string): void {
    if (this.write) {
      this.write(line);
      return;
    }
    console.error(line);
  }
}

function padLabel(label: string): string {
  return label.padEnd(10);
}

function colorFailureLine(line: string): string {
  if (!line) return line;
  const labeled = /^( {2})(waited|scores|next|traces|detail|on screen)(\s*)(.*)$/.exec(line);
  if (labeled) {
    const [, indent, label, spaces, rest] = labeled;
    return `${indent}${pc.dim(label)}${spaces}${rest}`;
  }
  if (/^ {4}/.test(line)) return pc.dim(line);
  if (!/^\s/.test(line)) return pc.red(line);
  return line;
}
