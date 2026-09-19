import type { Driver } from "../core/driver.js";
import type { ConvoyConfig } from "../core/config.js";
import { AndroidDriver } from "./android.js";
import { FixtureDriver } from "./fixture.js";
import { IosDriver } from "./ios.js";
import { WebDriver } from "./web.js";

export async function createDriver(config: ConvoyConfig): Promise<Driver> {
  switch (config.platform) {
    case "ios":
      return new IosDriver(config.ios, config.reset);
    case "android":
      return new AndroidDriver(config.android, config.reset);
    case "web":
      return new WebDriver(config.web, config.reset);
    case "fixture":
    default:
      return FixtureDriver.fromFile(config.fixture.path);
  }
}
