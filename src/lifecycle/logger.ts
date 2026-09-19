/** Lifecycle code talks through this so CLI can style the same events. */
export interface LifecycleLogger {
  phase(label: string): void;
  done(label: string, ms?: number): void;
  warn(label: string): void;
}

export const silentLogger: LifecycleLogger = {
  phase() {},
  done() {},
  warn() {},
};
