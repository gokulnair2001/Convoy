import type { Bounds, Element, Role } from "./element.js";
import { isOnScreen, normalizeBounds, parseAndroidBounds, parseAxFrame, type PixelFrame } from "./bounds.js";
import { mapAndroidRole, mapIosRole, mapWebRole } from "./roles.js";

export interface NormalizeOptions {
  /** Screen size in pixels. Inferred from the tree when omitted. */
  screen?: PixelFrame;
  /**
   * Keep disabled controls. Default true — over-filtering is the highest
   * risk in the system; the model cannot choose an omitted value.
   */
  includeDisabled?: boolean;
  /** Hard cap for Jev Choice (255 including `none`). */
  maxElements?: number;
}

export interface NormalizeResult {
  elements: Element[];
  dropped: {
    total: number;
    unlabeled: number;
    offscreen: number;
    zeroSize: number;
    unmapped: number;
    capped: number;
  };
  screen: PixelFrame;
}

interface Candidate {
  role: Role;
  name: string;
  value?: string;
  enabled: boolean;
  frame: PixelFrame;
  ref: unknown;
  actionable: boolean;
}

const ACTIONABLE: ReadonlySet<Role> = new Set(["button", "textfield", "toggle", "cell", "link", "tab"]);
const MAX_CHOICE_OPTIONS = 250;

export function normalizeIos(raw: unknown, opts: NormalizeOptions = {}): NormalizeResult {
  const nodes = flatten(raw);
  const screen = opts.screen ?? inferScreen(nodes, (n) => parseAxFrame(n.frame) ?? parseAxFrame(n.AXFrame));
  const candidates: Candidate[] = [];

  for (const node of nodes) {
    const frame = parseAxFrame(node.frame) ?? parseAxFrame(node.AXFrame);
    if (!frame) continue;
    const role = mapIosRole(str(node.type), str(node.role), str(node.role_description));
    const name = firstString(node.AXLabel, node.label, node.title, node.placeholder, node.name);
    const value = firstString(node.AXValue, node.value);
    candidates.push({
      role: role ?? "text",
      name: name ?? "",
      value,
      enabled: node.enabled !== false,
      frame,
      ref: { platform: "ios", frame, raw: node, unmapped: !role },
      actionable: Boolean(role && ACTIONABLE.has(role)),
    });
  }

  return finalize(candidates, screen, opts, nodes.length);
}

export function normalizeAndroid(raw: unknown, opts: NormalizeOptions = {}): NormalizeResult {
  const nodes = typeof raw === "string" ? parseUiAutomatorXml(raw) : flatten(raw);
  const screen = opts.screen ?? inferScreen(nodes, (n) => parseAndroidBounds(n.bounds) ?? parseAxFrame(n.frame));
  const candidates: Candidate[] = [];

  for (const node of nodes) {
    const frame = parseAndroidBounds(node.bounds) ?? parseAxFrame(node.frame);
    if (!frame) continue;
    const role = mapAndroidRole(str(node.class), str(node.role));
    const name = firstString(node["content-desc"], node.contentDesc, node.text, node.label, node.name);
    const value = firstString(node.text, node.value);
    candidates.push({
      role: role ?? "text",
      name: name ?? "",
      value: value !== name ? value : undefined,
      enabled: node.enabled !== false && node.enabled !== "false",
      frame,
      ref: { platform: "android", frame, raw: node },
      actionable: Boolean(role && ACTIONABLE.has(role)),
    });
  }

  return finalize(candidates, screen, opts, nodes.length);
}

export function normalizeWeb(raw: unknown, opts: NormalizeOptions = {}): NormalizeResult {
  const nodes = flatten(raw);
  const screen = opts.screen ?? inferScreen(nodes, (n) => parseAxFrame(n.frame) ?? parseAxFrame(n.bounds));
  const candidates: Candidate[] = [];

  for (const node of nodes) {
    const frame = parseAxFrame(node.frame) ?? parseAxFrame(node.bounds);
    if (!frame) continue;
    const role = mapWebRole(str(node.role), str(node.tag), str(node.type) ?? str(node.inputType));
    const name = firstString(node.name, node.label, node.title, node.placeholder, node.text);
    const value = firstString(node.value);
    candidates.push({
      role: role ?? "text",
      name: name ?? "",
      value,
      enabled: node.enabled !== false && node.disabled !== true,
      frame,
      ref: { platform: "web", frame, raw: node },
      actionable: Boolean(role && ACTIONABLE.has(role)),
    });
  }

  return finalize(candidates, screen, opts, nodes.length);
}

export function normalize(
  raw: unknown,
  platform: "ios" | "android" | "web",
  opts: NormalizeOptions = {},
): NormalizeResult {
  if (platform === "ios") return normalizeIos(raw, opts);
  if (platform === "android") return normalizeAndroid(raw, opts);
  return normalizeWeb(raw, opts);
}

function finalize(
  candidates: Candidate[],
  screen: PixelFrame,
  opts: NormalizeOptions,
  rawCount: number,
): NormalizeResult {
  const includeDisabled = opts.includeDisabled ?? true;
  const maxElements = opts.maxElements ?? MAX_CHOICE_OPTIONS;
  const dropped = {
    total: rawCount,
    unlabeled: 0,
    offscreen: 0,
    zeroSize: 0,
    unmapped: 0,
    capped: 0,
  };

  const kept: Candidate[] = [];
  for (const c of candidates) {
    if (c.frame.width <= 0 || c.frame.height <= 0) {
      dropped.zeroSize += 1;
      continue;
    }
    if (!isOnScreen(c.frame, screen)) {
      dropped.offscreen += 1;
      continue;
    }
    if (!c.name.trim()) {
      if (c.role === "textfield") {
        c.name = "text field";
      } else {
        dropped.unlabeled += 1;
        continue;
      }
    }
    if (!includeDisabled && !c.enabled) continue;
    kept.push(c);
  }

  kept.sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x || a.name.localeCompare(b.name));

  const deduped: Candidate[] = [];
  for (const c of kept) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.role === c.role &&
      prev.name === c.name &&
      Math.abs(prev.frame.x - c.frame.x) < 1 &&
      Math.abs(prev.frame.y - c.frame.y) < 1
    ) {
      continue;
    }
    deduped.push(c);
  }

  const prioritized = [
    ...deduped.filter((c) => c.actionable),
    ...deduped.filter((c) => !c.actionable),
  ];
  if (prioritized.length > maxElements) {
    dropped.capped = prioritized.length - maxElements;
  }
  const sliced = prioritized.slice(0, maxElements);

  const elements: Element[] = sliced.map((c, i) => {
    const bounds: Bounds = normalizeBounds(c.frame, screen);
    return {
      id: `e${i + 1}`,
      role: c.role,
      name: c.name.trim(),
      ...(c.value !== undefined && String(c.value).length > 0 ? { value: String(c.value) } : {}),
      enabled: c.enabled,
      bounds,
      ref: c.ref,
    };
  });

  return { elements, dropped: { ...dropped, total: rawCount }, screen };
}

type RawNode = Record<string, unknown> & { children?: unknown };

function flatten(raw: unknown): RawNode[] {
  const out: RawNode[] = [];
  const visit = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as RawNode;
    out.push(obj);
    if (obj.children) visit(obj.children);
    if (Array.isArray(obj.child)) visit(obj.child);
  };
  visit(raw);
  return out;
}

function inferScreen(nodes: RawNode[], frameOf: (n: RawNode) => PixelFrame | undefined): PixelFrame {
  let maxW = 0;
  let maxH = 0;
  for (const node of nodes) {
    const frame = frameOf(node);
    if (!frame) continue;
    maxW = Math.max(maxW, frame.x + frame.width, frame.width);
    maxH = Math.max(maxH, frame.y + frame.height, frame.height);
  }
  return { x: 0, y: 0, width: maxW || 390, height: maxH || 844 };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export function parseUiAutomatorXml(xml: string): RawNode[] {
  const nodes: RawNode[] = [];
  const nodeRe = /<node\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = nodeRe.exec(xml))) {
    const attrs = match[1] ?? "";
    const node: RawNode = {};
    const attrRe = /([:\w-]+)="([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrs))) {
      node[am[1]!] = decodeXml(am[2] ?? "");
    }
    nodes.push(node);
  }
  return nodes;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
