export interface PixelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseAxFrame(value: unknown): PixelFrame | undefined {
  if (!value) return undefined;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (isNum(o.x) && isNum(o.y) && isNum(o.width) && isNum(o.height)) {
      return { x: o.x, y: o.y, width: o.width, height: o.height };
    }
  }
  if (typeof value === "string") {
    const m = value.match(/\{\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}\s*,\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}\}/);
    if (m) {
      return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
    }
  }
  return undefined;
}

export function parseAndroidBounds(value: unknown): PixelFrame | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return undefined;
  const l = Number(m[1]);
  const t = Number(m[2]);
  const r = Number(m[3]);
  const b = Number(m[4]);
  return { x: l, y: t, width: r - l, height: b - t };
}

export function normalizeBounds(frame: PixelFrame, screen: PixelFrame): [number, number, number, number] {
  const w = screen.width || 1;
  const h = screen.height || 1;
  return clamp4([frame.x / w, frame.y / h, frame.width / w, frame.height / h]);
}

export function isOnScreen(frame: PixelFrame, screen: PixelFrame): boolean {
  if (frame.width <= 0 || frame.height <= 0) return false;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  return frame.x < screen.width && frame.y < screen.height && right > 0 && bottom > 0;
}

export function centerOf(frame: PixelFrame): { x: number; y: number } {
  return {
    x: Math.round(frame.x + frame.width / 2),
    y: Math.round(frame.y + frame.height / 2),
  };
}

function clamp4(b: [number, number, number, number]): [number, number, number, number] {
  return [
    clamp01(b[0]),
    clamp01(b[1]),
    Math.max(0, Math.min(1, b[2])),
    Math.max(0, Math.min(1, b[3])),
  ];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
