/**
 * Replace `${NAME}` with process env (or the provided map). Unknown names stay as-is.
 */
export function expandEnv(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name: string) => {
    const value = env[name];
    return value === undefined ? match : value;
  });
}
