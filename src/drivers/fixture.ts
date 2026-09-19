import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Driver } from "../core/driver.js";
import { EMPTY_PNG } from "../core/driver.js";
import type { Element, Platform } from "../core/element.js";
import { normalize } from "../core/normalize.js";

export interface FixtureTransition {
  from?: string;
  tapName?: string;
  tapId?: string;
  to: string;
}

export interface FixtureScreen {
  name: string;
  elements?: Element[];
  raw?: unknown;
  platform?: "ios" | "android" | "web";
}

export interface FixtureScript {
  emulatePlatform?: "ios" | "android" | "web";
  screenWidth?: number;
  screenHeight?: number;
  screens: FixtureScreen[];
  initial?: string;
  transitions?: FixtureTransition[];
}

export class FixtureDriver implements Driver {
  readonly kind: Platform = "fixture";
  private current: string;
  private readonly screens: Map<string, Element[]>;
  private readonly transitions: FixtureTransition[];

  constructor(private readonly script: FixtureScript) {
    this.screens = new Map();
    const screen = {
      x: 0,
      y: 0,
      width: script.screenWidth ?? 390,
      height: script.screenHeight ?? 844,
    };
    for (const s of script.screens) {
      if (s.elements) {
        this.screens.set(
          s.name,
          s.elements.map((el, i) => ({
            ...el,
            id: el.id || `e${i + 1}`,
            ref: el.ref ?? { platform: "fixture", id: el.id },
          })),
        );
      } else if (s.raw !== undefined) {
        const platform = s.platform ?? script.emulatePlatform ?? "ios";
        const result = normalize(s.raw, platform, { screen });
        this.screens.set(s.name, result.elements);
      } else {
        this.screens.set(s.name, []);
      }
    }
    this.transitions = script.transitions ?? [];
    this.current = script.initial ?? script.screens[0]?.name ?? "default";
  }

  static async fromFile(file: string): Promise<FixtureDriver> {
    const raw = await readFile(path.resolve(file), "utf8");
    const script = JSON.parse(raw) as FixtureScript;
    return new FixtureDriver(script);
  }

  get screenName(): string {
    return this.current;
  }

  async snapshot(): Promise<Element[]> {
    return (this.screens.get(this.current) ?? []).map((el) => ({ ...el }));
  }

  async tap(el: Element): Promise<void> {
    const next = this.transitions.find((t) => {
      if (t.from && t.from !== this.current) return false;
      if (t.tapId && t.tapId !== el.id) return false;
      if (t.tapName && t.tapName.toLowerCase() !== el.name.toLowerCase()) return false;
      return Boolean(t.tapId || t.tapName);
    });
    if (next) this.current = next.to;
  }

  async type(el: Element, text: string): Promise<void> {
    const screen = this.screens.get(this.current);
    if (!screen) return;
    const target = screen.find((e) => e.id === el.id);
    if (target) target.value = text;
  }

  async reset(): Promise<void> {
    this.current = this.script.initial ?? this.script.screens[0]?.name ?? "default";
    for (const screen of this.screens.values()) {
      for (const el of screen) {
        if (el.role === "textfield") delete el.value;
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    return EMPTY_PNG;
  }

  async back(): Promise<void> {
    const landing = this.script.initial ?? this.script.screens[0]?.name;
    if (landing && this.current !== landing) this.current = landing;
  }

  async close(): Promise<void> {
    // no-op
  }
}
