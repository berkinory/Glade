import type { DesktopBrowserManager } from "../browserManager";
import type { DesktopBrowserAutomationHostOptions } from "./automationHostPolicy";
import type { BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { createBrowserAutomationHostRuntime } from "./createBrowserAutomationHostRuntime";

export class DesktopBrowserAutomationHost {
  declare readonly dispose: BrowserAutomationHostRuntime["dispose"];
  declare readonly waitForIdle: BrowserAutomationHostRuntime["waitForIdle"];
  declare readonly executeTool: BrowserAutomationHostRuntime["executeTool"];

  constructor(
    browserManager: DesktopBrowserManager,
    options: DesktopBrowserAutomationHostOptions = {},
  ) {
    Object.assign(this, createBrowserAutomationHostRuntime(browserManager, options));
  }
}
