const SECRET_KEYS = /api[_-]?key|password|secret|token/i;

export function redactValue(key: string, value: string | undefined): string {
  if (!value) return "(unset)";
  if (SECRET_KEYS.test(key)) {
    if (value.length <= 4) return "****";
    return `${value.slice(0, 2)}…${value.slice(-2)}`;
  }
  return value;
}

export function redactEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("CONVOY_") && !key.startsWith("TYPESAFE_")) continue;
    out[key] = redactValue(key, value);
  }
  return out;
}
