export interface JevQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: Record<string, string | null> | string[];
}

export interface JevRequest {
  model?: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}

export interface NoulAnswer {
  type?: "noul";
  noul?: number;
  probability?: number;
}

export interface ChoiceAnswerRaw {
  type?: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

export interface ScoreAnswerRaw {
  type?: "score";
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export type JevAnswer = NoulAnswer | ChoiceAnswerRaw | ScoreAnswerRaw;

export interface JevResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevClient {
  systemOne(request: JevRequest): Promise<JevResponse>;
}

export function noulValue(answer: JevAnswer | undefined): number {
  if (!answer) return 0;
  const raw = answer as NoulAnswer;
  if (typeof raw.noul === "number") return raw.noul;
  if (typeof raw.probability === "number") return raw.probability;
  return 0;
}

export function asChoice(answer: JevAnswer | undefined): ChoiceAnswerRaw {
  const raw = answer as ChoiceAnswerRaw | undefined;
  return {
    type: "choice",
    choice: raw?.choice ?? "none",
    probabilities: raw?.probabilities ?? {},
    confidence: raw?.confidence,
  };
}

export function asScore(answer: JevAnswer | undefined): number {
  const raw = answer as ScoreAnswerRaw | undefined;
  return typeof raw?.score === "number" ? raw.score : 0;
}
