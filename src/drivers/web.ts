import type { Driver } from "../core/driver.js";
import { EMPTY_PNG } from "../core/driver.js";
import { fieldHasText, type Element } from "../core/element.js";
import type { PixelFrame } from "../core/bounds.js";
import { centerOf } from "../core/bounds.js";
import type { WebConfig, ResetStrategy } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { normalizeWeb } from "../core/normalize.js";

interface PlaywrightPage {
  goto: (url: string, opts?: { waitUntil?: string }) => Promise<unknown>;
  evaluate: <T>(fn: string | (() => T | Promise<T>)) => Promise<T>;
  mouse: { click: (x: number, y: number) => Promise<void> };
  keyboard: {
    type: (text: string, opts?: { delay?: number }) => Promise<void>;
    press: (key: string) => Promise<void>;
  };
  screenshot: (opts?: { type?: string }) => Promise<Buffer>;
  goBack: () => Promise<unknown>;
  context: () => { clearCookies: () => Promise<void> };
}

interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

interface WebRef {
  platform: "web";
  frame: PixelFrame;
  raw: unknown;
}

export class WebDriver implements Driver {
  readonly kind = "web" as const;
  private browser?: PlaywrightBrowser;
  private page?: PlaywrightPage;
  private screen: PixelFrame = { x: 0, y: 0, width: 1440, height: 900 };

  constructor(
    private readonly config: WebConfig,
    private readonly resetStrategy: ResetStrategy = "clear",
  ) {}

  async snapshot(): Promise<Element[]> {
    const page = await this.ensurePage();
    const raw = await page.evaluate<Array<Record<string, unknown>>>(COLLECT_DOM);
    const result = normalizeWeb(raw, { screen: this.screen });
    this.screen = result.screen;
    return result.elements;
  }

  async tap(el: Element): Promise<void> {
    const page = await this.ensurePage();
    const { x, y } = centerOf(frameOf(el));
    await page.mouse.click(x, y);
  }

  async type(el: Element, text: string): Promise<void> {
    const page = await this.ensurePage();
    await this.tap(el);
    if (fieldHasText(el)) {
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${mod}+A`);
      await page.keyboard.press("Backspace");
    }
    await page.keyboard.type(text);
  }

  async reset(): Promise<void> {
    const page = await this.ensurePage();
    if (this.resetStrategy !== "relaunch") {
      await page.context().clearCookies();
      await page.evaluate(CLEAR_STORAGE);
    }
    await page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded" });
  }

  async screenshot(): Promise<Buffer> {
    try {
      const page = await this.ensurePage();
      return await page.screenshot({ type: "png" });
    } catch {
      return EMPTY_PNG;
    }
  }

  async back(): Promise<void> {
    const page = await this.ensurePage();
    await page.goBack();
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  async rawDump(): Promise<unknown> {
    const page = await this.ensurePage();
    return page.evaluate(COLLECT_DOM);
  }

  private async ensurePage(): Promise<PlaywrightPage> {
    if (this.page) return this.page;
    let playwright: { chromium: { launch: (opts: { headless: boolean }) => Promise<PlaywrightBrowser> } };
    try {
      playwright = (await import("playwright")) as unknown as {
        chromium: { launch: (opts: { headless: boolean }) => Promise<PlaywrightBrowser> };
      };
    } catch {
      throw new ToolError({
        kind: "driver",
        title: "Playwright is not installed",
        hint: "run npm install playwright && npx playwright install chromium",
      });
    }
    this.browser = await playwright.chromium.launch({ headless: !this.config.headed });
    this.page = await this.browser.newPage();
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded" });
    return this.page;
  }
}

function frameOf(el: Element): PixelFrame {
  const ref = el.ref as WebRef | undefined;
  if (ref?.frame) return ref.frame;
  return { x: 0, y: 0, width: 0, height: 0 };
}

const CLEAR_STORAGE = `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} })()`;

const COLLECT_DOM = `(() => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const out = [];
  const all = document.querySelectorAll("body *");
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > height || rect.left > width) continue;
    const role = el.getAttribute("role") || undefined;
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (el instanceof HTMLInputElement && el.labels && el.labels[0] ? el.labels[0].textContent.trim() : "") ||
      (el.textContent ? el.textContent.trim().slice(0, 80) : "") ||
      "";
    out.push({
      tag: el.tagName.toLowerCase(),
      role,
      type: el instanceof HTMLInputElement ? el.type : undefined,
      name,
      value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : undefined,
      enabled: !el.disabled,
      frame: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }
  return out;
})()`;

