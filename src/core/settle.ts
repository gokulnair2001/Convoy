import type { Element } from "./element.js";

export async function waitForSettle(
  snapshot: () => Promise<Element[]>,
  opts: { timeoutMs?: number; stableMs?: number; intervalMs?: number } = {},
): Promise<Element[]> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const stableMs = opts.stableMs ?? 250;
  const intervalMs = opts.intervalMs ?? 100;
  const start = Date.now();
  let last = signature(await snapshot());
  let lastChange = Date.now();
  let current = last;

  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const next = signature(await snapshot());
    if (next !== last) {
      last = next;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= stableMs) {
      current = next;
      break;
    }
    current = next;
  }

  const elements = await snapshot();
  void current;
  return elements;
}

export function signature(elements: Element[]): string {
  return elements.map((e) => `${e.role}:${e.name}:${e.value ?? ""}:${e.enabled !== false}`).join("|");
}

/**
 * Poll snapshots until `attempt` succeeds. Dump duration is the throttle — no
 * sleep. After a retryable miss, skip Jev/resolve while the tree signature is
 * unchanged; call attempt again only when the tree changes (or on the first dump).
 */
export async function waitUntilPresent<T>(
  snapshot: () => Promise<Element[]>,
  attempt: (elements: Element[]) => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: { timeoutMs: number },
): Promise<T> {
  const start = Date.now();
  let lastSig: string | undefined;
  let lastError: unknown;

  for (;;) {
    const elements = await snapshot();
    const sig = signature(elements);

    if (lastSig !== undefined && sig === lastSig) {
      if (Date.now() - start >= opts.timeoutMs) throw lastError;
      continue;
    }

    try {
      return await attempt(elements);
    } catch (err) {
      if (!isRetryable(err) || Date.now() - start >= opts.timeoutMs) throw err;
      lastSig = sig;
      lastError = err;
    }
  }
}

export async function waitUntil<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 500;
  const start = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const elapsed = Date.now() - start;
      if (!isRetryable(err) || elapsed >= opts.timeoutMs) throw err;
      await sleep(intervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
