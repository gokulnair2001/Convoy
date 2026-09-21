export type Role =
  | "button"
  | "textfield"
  | "text"
  | "toggle"
  | "cell"
  | "link"
  | "image"
  | "tab"
  | "list";

export type Platform = "ios" | "android" | "web" | "fixture";

export type LogicalPlatform = "ios" | "android" | "web";

/** Normalized 0–1 rectangle: [x, y, width, height]. */
export type Bounds = [number, number, number, number];

export interface PixelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Element {
  id: string;
  role: Role;
  name: string;
  value?: string;
  enabled: boolean;
  bounds: Bounds;
  /** Opaque handle back to the platform node. Never sent to Jev. */
  ref: unknown;
}

export type PublicElement = Omit<Element, "ref">;

export function toPublicElement(el: Element): PublicElement {
  return {
    id: el.id,
    role: el.role,
    name: el.name,
    ...(el.value !== undefined ? { value: el.value } : {}),
    enabled: el.enabled,
    bounds: el.bounds,
  };
}

export function elementIndex(id: string): string {
  return id.replace(/^e/, "");
}

export function formatElement(el: Pick<Element, "id" | "name">): string {
  return `[${elementIndex(el.id)}] "${el.name}"`;
}

export function fieldHasText(el: Pick<Element, "value">): boolean {
  return Boolean(el.value && el.value.trim().length > 0);
}

/** Prefer the actual text field when Jev matched a nearby label. */
export function textFieldForTyping(elements: Element[], resolved: Element): Element {
  if (resolved.role === "textfield") return resolved;
  const fields = elements.filter((e) => e.role === "textfield" && e.enabled !== false);
  if (fields.length === 0) return resolved;
  if (fields.length === 1) return fields[0]!;
  const rx = resolved.bounds[0] + resolved.bounds[2] / 2;
  const ry = resolved.bounds[1] + resolved.bounds[3] / 2;
  return [...fields].sort((a, b) => dist(a, rx, ry) - dist(b, rx, ry))[0]!;
}

function dist(el: Element, x: number, y: number): number {
  const cx = el.bounds[0] + el.bounds[2] / 2;
  const cy = el.bounds[1] + el.bounds[3] / 2;
  return (cx - x) ** 2 + (cy - y) ** 2;
}

export function jevElement(el: Element): {
  id: string;
  role: Role;
  name: string;
  value?: string;
} {
  return {
    id: el.id,
    role: el.role,
    name: el.name,
    ...(el.value !== undefined ? { value: el.value } : {}),
  };
}

/** Case, punctuation, and spacing folded so "Log in" equals "log-in". */
export function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Controls whose visible name equals the phrase after {@link normalizeLabel}. */
export function elementsWithExactName(elements: Element[], intent: string): Element[] {
  const key = normalizeLabel(intent);
  if (!key) return [];
  return elements.filter((el) => normalizeLabel(el.name) === key);
}
