import pc from "picocolors";
import type { JevAnswer, JevClient, JevQuestion, JevRequest, JevResponse } from "./types.js";
import { asChoice, asScore, noulValue } from "./types.js";

export interface JevDebugLog {
  (line: string): void;
}

/**
 * Prints each System One question, the answer, or the thrown error.
 * Element values are omitted (credentials / PII stay out of the console).
 */
export function wrapJevDebug(
  client: JevClient,
  opts: { enabled: boolean; log?: JevDebugLog } = { enabled: true },
): JevClient {
  if (!opts.enabled) return client;
  const log = opts.log ?? ((line) => process.stdout.write(`${line}\n`));
  let seq = 0;
  return {
    async systemOne(request: JevRequest): Promise<JevResponse> {
      const n = (seq += 1);
      const started = Date.now();
      log(formatJevRequest(n, request));
      try {
        const response = await client.systemOne(request);
        log(formatJevResponse(n, response, Date.now() - started));
        return response;
      } catch (err) {
        log(formatJevThrown(n, err, Date.now() - started));
        throw err;
      }
    },
  };
}

export function formatJevRequest(n: number, request: JevRequest): string {
  const lines = [pc.magenta(`── jev #${n}  question`)];
  const screen = screenContext(request.state);
  if (screen) lines.push(pc.dim(`   screen    ${screen}`));
  const names = elementNames(request.state);
  if (names) lines.push(pc.dim(`   elements  ${names}`));
  for (const [id, question] of Object.entries(request.questions)) {
    lines.push(...formatQuestion(id, question));
  }
  return lines.join("\n");
}

export function formatJevResponse(n: number, response: JevResponse, ms: number): string {
  const usage = response.usage?.input_tokens
    ? `  ${response.usage.input_tokens} in`
    : "";
  const lines = [pc.magenta(`── jev #${n}  result`) + pc.dim(`  ${ms}ms${usage}`)];
  for (const [id, answer] of Object.entries(response.answers ?? {})) {
    lines.push(`   ${id.padEnd(10)} ${formatAnswer(answer)}`);
  }
  if (Object.keys(response.answers ?? {}).length === 0) {
    lines.push(pc.dim("   (no answers)"));
  }
  return lines.join("\n");
}

export function formatJevThrown(n: number, err: unknown, ms: number): string {
  const message = err instanceof Error ? err.message : String(err);
  return [
    pc.red(`── jev #${n}  thrown`) + pc.dim(`  ${ms}ms`),
    `   ${message}`,
  ].join("\n");
}

function formatQuestion(id: string, question: JevQuestion): string[] {
  const head = `   ${id.padEnd(10)} ${question.type.padEnd(7)} ${question.instructions}`;
  const extra = formatCriteria(question.criteria);
  return extra ? [head, ...extra.map((line) => `             ${line}`)] : [head];
}

function formatCriteria(criteria: JevQuestion["criteria"]): string[] {
  if (!criteria) return [];
  if (Array.isArray(criteria)) return [criteria.join(" | ")];
  const entries = Object.entries(criteria);
  const elementIds = entries.filter(([k]) => /^e\d+$/.test(k));
  if (elementIds.length > 8) {
    const other = entries.filter(([k]) => !/^e\d+$/.test(k));
    const summary = `${elementIds.length} element options`;
    return other.length > 0
      ? [summary, ...other.map(([k, v]) => `${k}: ${v ?? "null"}`)]
      : [summary];
  }
  return entries.map(([k, v]) => `${k}: ${v ?? "null"}`);
}

function formatAnswer(answer: JevAnswer): string {
  if ("choice" in answer && answer.choice !== undefined) {
    const choice = asChoice(answer);
    const ranked = Object.entries(choice.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, p]) => `${id} ${p.toFixed(2)}`)
      .join("  ");
    return `choice  ${choice.choice}${ranked ? `    ${ranked}` : ""}`;
  }
  if ("score" in answer && typeof (answer as { score?: number }).score === "number") {
    return `score   ${asScore(answer).toFixed(2)}`;
  }
  return `noul    ${noulValue(answer).toFixed(2)}`;
}

function screenContext(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const screen = (state as { screen?: unknown }).screen;
  if (typeof screen === "string" && screen.trim()) return screen;
  if (!screen || typeof screen !== "object") return undefined;
  const s = screen as { platform?: unknown; title?: unknown; labels?: unknown };
  const parts: string[] = [];
  if (typeof s.title === "string" && s.title.trim()) parts.push(`title=${JSON.stringify(s.title)}`);
  if (Array.isArray(s.labels) && s.labels.length > 0) {
    const labels = s.labels
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, 16)
      .map((x) => JSON.stringify(x));
    const more = s.labels.length > 16 ? ` +${s.labels.length - 16}` : "";
    parts.push(`labels ${labels.join("  ")}${more}`);
  } else if (typeof s.platform === "string") {
    parts.push(s.platform);
  }
  return parts.length > 0 ? parts.join("  ") : undefined;
}

function elementNames(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const elements = (state as { elements?: unknown }).elements;
  if (!Array.isArray(elements) || elements.length === 0) return undefined;
  const names: string[] = [];
  for (const el of elements.slice(0, 12)) {
    if (!el || typeof el !== "object") continue;
    const o = el as { id?: string; name?: string };
    if (!o.id || !o.name) continue;
    names.push(`[${o.id.replace(/^e/, "")}] ${JSON.stringify(o.name)}`);
  }
  const more = elements.length > 12 ? `  +${elements.length - 12}` : "";
  return names.join("  ") + more;
}
