import { formatFailure, mergeReport, type FailureKind, type FailureReport } from "./failure.js";

export type GateOutcome = "pass" | "ambiguous" | "not_found" | "assert_failed";

export type ConvoyOutcome = GateOutcome | "timeout" | "driver" | "jev" | "config";

export class ConvoyError extends Error {
  declare readonly outcome: ConvoyOutcome;
  declare readonly report: FailureReport;
  declare readonly traceDir?: string;
  declare readonly step?: string;

  constructor(report: FailureReport, outcome?: ConvoyOutcome) {
    super(formatFailure(report));
    this.name = "ConvoyError";
    const resolved = outcome ?? kindToOutcome(report.kind);
    Object.defineProperties(this, {
      report: { value: report, enumerable: false },
      outcome: { value: resolved, enumerable: false },
      traceDir: { value: report.traceDir, enumerable: false },
      step: { value: report.action, enumerable: false },
    });
  }
}

export class AmbiguousError extends ConvoyError {
  constructor(report: FailureReport) {
    super(report, "ambiguous");
    this.name = "AmbiguousError";
  }
}

export class NotFoundError extends ConvoyError {
  constructor(report: FailureReport) {
    super(report, report.kind === "timeout" ? "timeout" : "not_found");
    this.name = "NotFoundError";
  }
}

export class AssertionFailedError extends ConvoyError {
  constructor(report: FailureReport) {
    super(report, report.kind === "timeout" ? "timeout" : "assert_failed");
    this.name = "AssertionFailedError";
  }
}

export class ToolError extends ConvoyError {
  constructor(report: FailureReport) {
    super(report, report.kind === "jev" ? "jev" : "driver");
    this.name = "ToolError";
  }
}

export function enrichFailure(err: unknown, extra: Partial<FailureReport>): unknown {
  if (!(err instanceof ConvoyError)) return err;
  const report = mergeReport(err.report, extra);
  if (err instanceof AmbiguousError) return new AmbiguousError(report);
  if (err instanceof AssertionFailedError) return new AssertionFailedError(report);
  if (err instanceof NotFoundError) return new NotFoundError(report);
  if (err instanceof ToolError) return new ToolError(report);
  return new ConvoyError(report, err.outcome);
}

function kindToOutcome(kind: FailureKind): ConvoyOutcome {
  if (kind === "not_found" || kind === "ambiguous" || kind === "assert_failed") return kind;
  return kind;
}
