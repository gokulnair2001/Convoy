import type { Element, Platform } from "./element.js";

export interface Driver {
  readonly kind: Platform;
  snapshot(): Promise<Element[]>;
  tap(el: Element): Promise<void>;
  type(el: Element, text: string): Promise<void>;
  reset(): Promise<void>;
  screenshot(): Promise<Buffer>;
  back(): Promise<void>;
  close(): Promise<void>;
}

export const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhQGUpFqK0QAAAABJRU5ErkJggg==",
  "base64",
);
