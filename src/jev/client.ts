import type { JevClient, JevRequest, JevResponse } from "./types.js";
import type { JevConfig } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { jevHttpReport } from "../core/failure.js";
import { wrapJevDebug } from "./debug.js";

export async function createJevClient(config: JevConfig): Promise<JevClient> {
  const inner = await createInnerJevClient(config);
  return wrapJevDebug(inner, { enabled: config.debug });
}

async function createInnerJevClient(config: JevConfig): Promise<JevClient> {
  if (config.mode === "heuristic") return new HeuristicJevClient();
  if (config.mode === "recorded") {
    const { RecordedJevClient } = await import("./recorded.js");
    return new RecordedJevClient(config.recordedDir ?? ".convoy/recorded");
  }
  return createLiveClient(config);
}

async function createLiveClient(config: JevConfig): Promise<JevClient> {
  try {
    const sdk = await import("@typesafe-ai/sdk");
    return new SdkJevClient(sdk, config);
  } catch {
    return new HttpJevClient(config);
  }
}

interface SdkModule {
  TypeSafeClient: new (opts?: Record<string, unknown>) => {
    systemOne: (req: unknown) => Promise<{
      model?: string;
      answers: Record<string, unknown>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
  choice: (instructions: string, criteria: Record<string, string | null>) => unknown;
  noul: (instructions: string, criteria?: Record<string, string>) => unknown;
  score: (instructions: string, criteria: string[]) => unknown;
}

class SdkJevClient implements JevClient {
  private readonly inner: InstanceType<SdkModule["TypeSafeClient"]>;
  private readonly sdk: SdkModule;
  private readonly model: string;

  constructor(sdk: SdkModule, config: JevConfig) {
    this.sdk = sdk;
    this.model = config.model;
    this.inner = new sdk.TypeSafeClient({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultModel: config.model,
    });
  }

  async systemOne(request: JevRequest): Promise<JevResponse> {
    const questions: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === "choice") {
        questions[id] = this.sdk.choice(q.instructions, (q.criteria as Record<string, string | null>) ?? {});
      } else if (q.type === "score") {
        questions[id] = this.sdk.score(q.instructions, (q.criteria as string[]) ?? ["low", "high"]);
      } else {
        questions[id] = this.sdk.noul(q.instructions);
      }
    }
    const result = await this.inner.systemOne({
      state: request.state,
      model: request.model ?? this.model,
      questions,
    });
    return result as JevResponse;
  }
}

export class HttpJevClient implements JevClient {
  constructor(private readonly config: JevConfig) {}

  async systemOne(request: JevRequest): Promise<JevResponse> {
    if (!this.config.apiKey) {
      throw new ToolError({
        kind: "jev",
        title: "TYPESAFE_API_KEY is not set",
        hint: "put it in .env (gitignored) or the CI secret store",
        next: ["convoy doctor"],
      });
    }
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/systemone`;
    const body = {
      model: request.model ?? this.config.model,
      state: request.state,
      questions: request.questions,
    };
    const payload = JSON.stringify(body);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: payload,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (res.status === 429 || res.status === 529) {
          await sleep(2 ** attempt * 250);
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new ToolError(jevHttpReport(res.status, text));
        }
        return (await res.json()) as JevResponse;
      } catch (err) {
        lastError = err as Error;
        if (attempt < 3 && /timeout|fetch|network/i.test(String(err))) {
          await sleep(2 ** attempt * 250);
          continue;
        }
        throw err;
      }
    }
        throw lastError ??
          new ToolError({
            kind: "jev",
            title: "Jev request failed",
            hint: "check network and TYPESAFE_API_KEY, then convoy doctor",
            next: ["convoy doctor"],
          });
  }
}

export class HeuristicJevClient implements JevClient {
  async systemOne(request: JevRequest): Promise<JevResponse> {
    const elements = extractElements(request.state);
    const answers: JevResponse["answers"] = {};

    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "noul") {
        const p = noulHeuristic(question.instructions, elements);
        answers[id] = { type: "noul", noul: p, probability: p };
      } else if (question.type === "choice") {
        answers[id] = choiceHeuristic(question.instructions, question.criteria as Record<string, string | null>, elements);
      } else {
        const p = noulHeuristic(question.instructions, elements);
        answers[id] = { type: "score", score: p * 2, probabilities: { "0": 1 - p, "1": 0, "2": p } };
      }
    }

    return { model: "heuristic", answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

function extractElements(state: unknown): Array<{ id: string; role?: string; name: string; value?: string }> {
  if (!state || typeof state !== "object") return [];
  const s = state as { elements?: unknown };
  if (!Array.isArray(s.elements)) return [];
  const out: Array<{ id: string; role?: string; name: string; value?: string }> = [];
  for (const e of s.elements) {
    if (!e || typeof e !== "object") continue;
    const o = e as { id?: string; role?: string; name?: string; value?: string };
    if (!o.id || !o.name) continue;
    out.push({ id: o.id, role: o.role, name: o.name, value: o.value });
  }
  return out;
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "in",
  "of",
  "for",
  "and",
  "or",
  "user",
  "that",
  "this",
  "with",
  "on",
  "button",
  "field",
  "control",
  "screen",
  "page",
  "message",
  "matching",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`"']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

const NAME_MATCH = 0.55;
const CTA_SCORE = 0.78;
const ADVANCE_STRONG = new Set([
  "continue",
  "next",
  "proceed",
  "submit",
  "login",
  "signin",
  "log",
  "sign",
  "done",
  "save",
  "apply",
  "start",
  "started",
  "ok",
  "okay",
]);
const ADVANCE_WEAK = new Set(["get", "go", "lets", "let"]);

function intentFromInstructions(instructions: string): string {
  const line = instructions.match(/^Intent:\s*(.+)$/m);
  if (line) return line[1]!.trim();
  const quoted = instructions.match(/:\s*(.+?)\??$/);
  if (quoted) return quoted[1]!.trim();
  return instructions;
}

function isTapResolve(instructions: string): boolean {
  return /^Action:\s*tap\b/m.test(instructions);
}

function isBareAdvanceIntent(intent: string): boolean {
  const tokens = tokenize(intent);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => ADVANCE_STRONG.has(t) || ADVANCE_WEAK.has(t))) return false;
  return tokens.some((t) => ADVANCE_STRONG.has(t));
}

function isSideAction(name: string): boolean {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (/forgot|sso|\bguest\b|create account|sign up|\bregister\b|already have|not now|\bskip\b/.test(n)) {
    return true;
  }
  return /^(back|close|cancel|menu|more)$/.test(n);
}

function isPrimaryForwardCta(el: { name: string; role?: string }): boolean {
  if (el.role !== "button" && el.role !== "link") return false;
  return !isSideAction(el.name);
}

function scoreName(intent: string, name: string, role?: string): number {
  const a = tokenize(intent);
  const b = tokenize(name);
  if (a.length === 0) return 0;
  if (b.length === 0) return 0;
  const setB = new Set(b);
  const overlap = a.filter((t) => setB.has(t)).length;
  if (overlap === 0) return roleBonus(intent, role) * 0.1;
  const jaccard = overlap / new Set([...a, ...b]).size;
  const coverage = overlap / a.length;
  const extra = b.filter((t) => !a.includes(t)).length;
  const exact = name.toLowerCase().trim() === intent.toLowerCase().trim() ? 0.5 : 0;
  return Math.max(0, coverage * 0.6 + jaccard * 0.4 + exact + roleBonus(intent, role) - extra * 0.35);
}

function scoreElement(
  intent: string,
  el: { id: string; name: string; role?: string },
  opts: { tap: boolean; elements: Array<{ id: string; name: string; role?: string }> },
): number {
  const base = scoreName(intent, el.name, el.role);
  if (!opts.tap) return base;
  const bestName = Math.max(0, ...opts.elements.map((e) => scoreName(intent, e.name, e.role)));
  if (bestName >= NAME_MATCH) return base;
  if (!isBareAdvanceIntent(intent)) return base;
  const ctas = opts.elements.filter((e) => isPrimaryForwardCta(e));
  if (ctas.length === 1 && ctas[0]!.id === el.id) return Math.max(base, CTA_SCORE);
  return base;
}

function roleBonus(intent: string, role?: string): number {
  if (!role) return 0;
  const i = intent.toLowerCase();
  if (role === "textfield" && /\b(field|input|email|password|username|text)\b/.test(i)) return 0.45;
  if (role === "button" && /\b(button|tap|press|submit|continue|sign)\b/.test(i)) return 0.25;
  if (role === "link" && /\b(link|account)\b/.test(i)) return 0.2;
  if (role === "tab" && /\btab\b/.test(i)) return 0.25;
  if (role === "text" && /\b(screen|title|heading|list)\b/.test(i)) return 0.2;
  return 0;
}

function noulHeuristic(instructions: string, elements: Array<{ id: string; name: string; role?: string }>): number {
  const intent = intentFromInstructions(instructions);
  const tap = isTapResolve(instructions);
  const negated =
    !/^Action:\s/m.test(instructions) && /\bnot\b|\babsent\b|\bno\b/.test(instructions.toLowerCase());
  const scores = elements.map((e) => scoreElement(intent, e, { tap, elements }));
  const best = Math.max(0, ...scores);
  let p = best >= 0.55 ? 0.96 : best >= 0.3 ? 0.7 : 0.06;
  if (/error message|error banner|alert/.test(intent.toLowerCase()) && best < 0.3) p = 0.04;
  if (/screen|page|list/.test(intent.toLowerCase()) && best >= 0.25) p = 0.96;
  if (negated) p = 1 - p;
  return p;
}

function choiceHeuristic(
  instructions: string,
  criteria: Record<string, string | null>,
  elements: Array<{ id: string; name: string; role?: string }>,
): ChoiceAnswerRawLike {
  const intent = intentFromInstructions(instructions);
  const tap = isTapResolve(instructions);
  const ids = Object.keys(criteria);
  const scores: Record<string, number> = {};
  for (const id of ids) {
    if (id === "none") {
      scores[id] = 0.02;
      continue;
    }
    const el = elements.find((e) => e.id === id);
    if (el) {
      scores[id] = scoreElement(intent, el, { tap, elements });
    } else {
      const criterion = criteria[id] ?? id;
      scores[id] = Math.max(0, ...elements.map((e) => scoreName(criterion, e.name, e.role)));
    }
  }
  const sum = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const probabilities: Record<string, number> = {};
  for (const id of ids) {
    probabilities[id] = (scores[id] ?? 0) / sum;
  }
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] ?? ["none", 1];
  if ((scores[top[0]] ?? 0) < 0.2) {
    probabilities.none = 0.8;
    const rest = 0.2;
    const otherSum = ranked.filter((r) => r[0] !== "none").reduce((a, b) => a + b[1], 0) || 1;
    for (const [id] of ranked) {
      if (id === "none") continue;
      probabilities[id] = ((probabilities[id] ?? 0) / otherSum) * rest;
    }
  }
  const finalRanked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return {
    type: "choice",
    choice: finalRanked[0]?.[0] ?? "none",
    probabilities,
    confidence: finalRanked[0]?.[1] ?? 0,
  };
}

interface ChoiceAnswerRawLike {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
