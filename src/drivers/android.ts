import type { Driver } from "../core/driver.js";
import { EMPTY_PNG } from "../core/driver.js";
import { fieldHasText, type Element } from "../core/element.js";
import type { PixelFrame } from "../core/bounds.js";
import { centerOf } from "../core/bounds.js";
import type { AndroidConfig, ResetStrategy } from "../core/config.js";
import { normalizeAndroid } from "../core/normalize.js";
import { ToolError } from "../core/errors.js";
import { execOk } from "../util/exec.js";

export function adbArgs(serial: string | undefined, args: string[]): string[] {
  return serial ? ["-s", serial, ...args] : args;
}

export function androidLaunchArgs(pkg: string): string[] {
  return ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"];
}

export function requireAndroidApk(config: AndroidConfig): string {
  if (!config.apkPath) {
    throw new ToolError({
      kind: "config",
      title: "android reinstall needs an APK path",
      hint: "set android.apkPath / CONVOY_ANDROID_APK, or use reset=clear",
    });
  }
  return config.apkPath;
}

export async function reinstallAndroidApp(
  config: AndroidConfig,
  run: (args: string[], opts?: { timeoutMs?: number }) => Promise<string>,
): Promise<void> {
  await run(["uninstall", config.package]).catch(() => undefined);
  await run(["install", "-r", requireAndroidApk(config)], { timeoutMs: 120_000 });
  await run(androidLaunchArgs(config.package));
}

interface AndroidRef {
  platform: "android";
  frame: PixelFrame;
  raw: unknown;
}

export class AndroidDriver implements Driver {
  readonly kind = "android" as const;
  private screen: PixelFrame = { x: 0, y: 0, width: 1080, height: 2400 };

  constructor(
    private readonly config: AndroidConfig,
    private readonly resetStrategy: ResetStrategy = "clear",
  ) {}

  private adb(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
    return execOk("adb", adbArgs(this.config.serial, args), opts);
  }

  async snapshot(): Promise<Element[]> {
    const xml = await this.dumpXml();
    const result = normalizeAndroid(xml, { screen: this.screen });
    this.screen = result.screen;
    return result.elements;
  }

  async tap(el: Element): Promise<void> {
    const frame = frameOf(el);
    const { x, y } = centerOf(frame);
    await this.adb(["shell", "input", "tap", String(x), String(y)]);
  }

  async type(el: Element, text: string): Promise<void> {
    await this.tap(el);
    if (fieldHasText(el)) {
      const n = el.value!.trim().length;
      await this.adb([
        "shell",
        "input",
        "keyevent",
        "KEYCODE_MOVE_END",
        ...Array.from({ length: n }, () => "KEYCODE_DEL"),
      ]);
    }
    const escaped = text.replace(/ /g, "%s").replace(/['"]/g, "");
    await this.adb(["shell", "input", "text", escaped]);
  }

  async reset(): Promise<void> {
    const pkg = this.config.package;
    if (this.resetStrategy === "reinstall") {
      await reinstallAndroidApp(this.config, (args, opts) => this.adb(args, opts));
      return;
    }
    if (this.resetStrategy === "clear") {
      await this.adb(["shell", "pm", "clear", pkg]);
    } else {
      await this.adb(["shell", "am", "force-stop", pkg]);
    }
    await this.adb(androidLaunchArgs(pkg));
  }

  async screenshot(): Promise<Buffer> {
    try {
      const stdout = await this.adb(["exec-out", "screencap", "-p"]);
      return Buffer.from(stdout, "binary");
    } catch {
      return EMPTY_PNG;
    }
  }

  async back(): Promise<void> {
    await this.adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  }

  async close(): Promise<void> {
    // adb stays connected
  }

  async rawDump(): Promise<string> {
    return this.dumpXml();
  }

  private async dumpXml(): Promise<string> {
    try {
      return await this.adb(["exec-out", "uiautomator", "dump", "/dev/tty"]);
    } catch {
      await this.adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"]);
      return this.adb(["shell", "cat", "/sdcard/window_dump.xml"]);
    }
  }
}

function frameOf(el: Element): PixelFrame {
  const ref = el.ref as AndroidRef | undefined;
  if (ref?.frame) return ref.frame;
  return { x: 0, y: 0, width: 0, height: 0 };
}
