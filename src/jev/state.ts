import { jevElement, type Element } from "../core/element.js";

const MAX_LABELS = 40;
const TITLE_CHROME = new Set(["back", "close", "cancel", "done", "more", "menu"]);

export interface JevScreenContext {
  platform: string;
  title?: string;
  labels: string[];
}

export interface JevState {
  screen: JevScreenContext;
  elements: ReturnType<typeof jevElement>[];
}

/** Shared System One state: platform id plus the labelled copy on screen. */
export function buildJevState(
  platform: string,
  elements: Element[],
  opts: { includeValues?: boolean } = {},
): JevState {
  const labels = screenLabels(elements);
  const title = screenTitle(elements);
  const includeValues = opts.includeValues ?? false;
  return {
    screen: {
      platform,
      ...(title ? { title } : {}),
      labels,
    },
    elements: elements.map((el) => {
      const pub = jevElement(el);
      if (includeValues) return pub;
      const { value: _value, ...rest } = pub;
      return rest;
    }),
  };
}

/** Unique visible names in reading order (top → bottom). Names only — no field values. */
export function screenLabels(elements: Element[]): string[] {
  const ordered = [...elements].sort(
    (a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0],
  );
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const el of ordered) {
    const name = el.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    labels.push(name);
    if (labels.length >= MAX_LABELS) break;
  }
  return labels;
}

/** Best heading: top-of-screen static text, skipping chrome like Back. */
export function screenTitle(elements: Element[]): string | undefined {
  const top = [...elements]
    .filter((el) => el.bounds[1] < 0.28)
    .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);

  const texts = top.filter((el) => el.role === "text");
  for (const el of texts) {
    if (!isChrome(el.name)) return el.name.trim();
  }
  for (const el of top) {
    if (el.role === "tab") continue;
    if (!isChrome(el.name)) return el.name.trim();
  }
  return undefined;
}

function isChrome(name: string): boolean {
  return TITLE_CHROME.has(name.trim().toLowerCase());
}
