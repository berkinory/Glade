import { app } from "electron";
import type { DesktopBrowserManager } from "../browserManager";
import { DesktopBrowserAutomationHostOptions } from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { createAutomationNavigation } from "./automationNavigation";
import { createAutomationOperationGuards } from "./automationOperationGuards";
import { AutomationSessionRegistry } from "./automationSessionAffinity";
import { createAutomationToolDispatch } from "./automationToolDispatch";
import { createAutomationToolRequests } from "./automationToolRequests";
import { createAutomationWindowOpen } from "./automationWindowOpen";
import { BrowserDiagnosticsStore } from "./browserDiagnostics";
import { createWorkspaceUpload } from "./workspaceUpload";

export function createBrowserAutomationHostRuntime(
  browserManager: DesktopBrowserManager,
  options: DesktopBrowserAutomationHostOptions = {},
): BrowserAutomationHostRuntime {
  // Assemble callable operations before resources can invoke their callbacks.
  const hostRuntime = {} as {
    -readonly [Key in keyof BrowserAutomationHostRuntime]: BrowserAutomationHostRuntime[Key];
  };
  Object.assign(hostRuntime, createAutomationToolRequests(hostRuntime));
  Object.assign(hostRuntime, createAutomationOperationGuards(hostRuntime));
  Object.assign(hostRuntime, createAutomationWindowOpen(hostRuntime));
  Object.assign(hostRuntime, createAutomationToolDispatch(hostRuntime));
  Object.assign(hostRuntime, createAutomationNavigation(hostRuntime));
  hostRuntime.sessionRegistry = new AutomationSessionRegistry();
  hostRuntime.lockTails = new Map<string, Promise<void>>();
  hostRuntime.activeOperations = new Set<Promise<unknown>>();
  hostRuntime.diagnostics = new BrowserDiagnosticsStore();
  hostRuntime.uploadBrowserFiles = createWorkspaceUpload({
    getUserDataRoot: () => app.getPath("userData"),
  });
  hostRuntime.requestOpenPanel = undefined;
  hostRuntime.disposed = false;
  hostRuntime.disposal = null;
  hostRuntime.options = options;
  hostRuntime.browserManager = browserManager;

  hostRuntime.requestOpenPanel = options.requestOpenPanel;

  return hostRuntime;
}
