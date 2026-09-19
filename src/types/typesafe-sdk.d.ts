declare module "@typesafe-ai/sdk" {
  export class TypeSafeClient {
    constructor(config?: Record<string, unknown>);
    systemOne(request: unknown): Promise<{
      model?: string;
      answers: Record<string, unknown>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  }
  export function choice(instructions: string, criteria: Record<string, string | null>): unknown;
  export function noul(instructions: string, criteria?: Record<string, string>): unknown;
  export function score(instructions: string, criteria: string[]): unknown;
}
