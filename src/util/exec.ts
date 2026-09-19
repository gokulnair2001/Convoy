import { spawn } from "node:child_process";
import { ToolError } from "../core/errors.js";
import { toolReport } from "../core/failure.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function exec(command: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: opts.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new ToolError(
          toolReport({
            command,
            args,
            title: `${command} timed out`,
            hint: `${command} hung — check the simulator/emulator is responsive`,
          }),
        ),
      );
    }, opts.timeoutMs ?? 30_000);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function execOk(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const result = await exec(command, args, opts);
  if (result.code !== 0) {
    throw new ToolError(
      toolReport({
        command,
        args,
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
      }),
    );
  }
  return result.stdout;
}

export async function which(command: string): Promise<string | undefined> {
  try {
    const result = await exec("which", [command]);
    if (result.code === 0) return result.stdout.trim();
  } catch {
    return undefined;
  }
  return undefined;
}
