import type { DesktopBrowserManager } from "../browserManager";
import {
  BrowserAutomationToolRequest,
  DesktopBrowserAutomationHostOptions,
} from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { createBrowserAutomationHostRuntime } from "./createBrowserAutomationHostRuntime";
export class DesktopBrowserAutomationHost {
  private readonly hostRuntime: BrowserAutomationHostRuntime;
  constructor(
    browserManager: DesktopBrowserManager,
    options: DesktopBrowserAutomationHostOptions = {},
  ) {
    this.hostRuntime = createBrowserAutomationHostRuntime(browserManager, options);
  }
  dispose(): Promise<void> {
    return this.hostRuntime.dispose();
  }
  waitForIdle(): Promise<void> {
    return this.hostRuntime.waitForIdle();
  }
  executeTool(request: BrowserAutomationToolRequest): Promise<unknown> {
    return this.hostRuntime.executeTool(request);
  }
}
