import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolError } from "../core/errors.js";
import type { JevClient, JevRequest, JevResponse } from "./types.js";

export class RecordedJevClient implements JevClient {
  constructor(
    private readonly dir: string,
    private readonly live?: JevClient,
  ) {}

  async systemOne(request: JevRequest): Promise<JevResponse> {
    const key = hashRequest(request);
    const file = path.join(this.dir, `${key}.json`);
    try {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as JevResponse;
    } catch {
      if (!this.live) {
        throw new ToolError({
          kind: "jev",
          title: "no recorded Jev response for this screen",
          hint: "run once with live Jev (TYPESAFE_API_KEY) to capture, or set CONVOY_JEV_MODE=heuristic",
          detail: key,
        });
      }
      const response = await this.live.systemOne(request);
      await mkdir(this.dir, { recursive: true });
      await writeFile(file, `${JSON.stringify(response, null, 2)}\n`, "utf8");
      return response;
    }
  }
}

export function hashRequest(request: JevRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 16);
}
