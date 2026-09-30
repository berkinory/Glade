import { type BrowserRuntime } from "./browserRuntimeTypes";
import { type DesktopBrowserManagerOptions } from "./browserTabState";
import { createBrowserRuntime } from "./createBrowserRuntime";

export class DesktopBrowserManager {
  declare readonly setWindow: BrowserRuntime["setWindow"];
  declare readonly isWebMcpCompatibilityAllowed: BrowserRuntime["isWebMcpCompatibilityAllowed"];
  declare readonly subscribe: BrowserRuntime["subscribe"];
  declare readonly subscribeCopyLink: BrowserRuntime["subscribeCopyLink"];
  declare readonly subscribeAnnotationEvents: BrowserRuntime["subscribeAnnotationEvents"];
  declare readonly startAnnotation: BrowserRuntime["startAnnotation"];
  declare readonly cancelAnnotation: BrowserRuntime["cancelAnnotation"];
  declare readonly syncAnnotationMarkers: BrowserRuntime["syncAnnotationMarkers"];
  declare readonly resolveAnnotationNavigationTarget: BrowserRuntime["resolveAnnotationNavigationTarget"];
  declare readonly handleAnnotationGuestMessage: BrowserRuntime["handleAnnotationGuestMessage"];
  declare readonly isAnnotationInteractive: BrowserRuntime["isAnnotationInteractive"];
  declare readonly isTrustedRenderer: BrowserRuntime["isTrustedRenderer"];
  declare readonly trackAutomationWindowOpen: BrowserRuntime["trackAutomationWindowOpen"];
  declare readonly trackAutomationDownload: BrowserRuntime["trackAutomationDownload"];
  declare readonly dispose: BrowserRuntime["dispose"];
  declare readonly getPerformanceSnapshot: BrowserRuntime["getPerformanceSnapshot"];
  declare readonly getAutomationHumanControlEpoch: BrowserRuntime["getAutomationHumanControlEpoch"];
  declare readonly isHumanBrowserOperationActive: BrowserRuntime["isHumanBrowserOperationActive"];
  declare readonly beginHumanBrowserOperation: BrowserRuntime["beginHumanBrowserOperation"];
  declare readonly subscribeAutomationHumanControl: BrowserRuntime["subscribeAutomationHumanControl"];
  declare readonly prepareAutomationTab: BrowserRuntime["prepareAutomationTab"];
  declare readonly selectAutomationTab: BrowserRuntime["selectAutomationTab"];
  declare readonly prepareAutomationNavigation: BrowserRuntime["prepareAutomationNavigation"];
  declare readonly getVisibleAutomationRuntime: BrowserRuntime["getVisibleAutomationRuntime"];
  declare readonly getCookieImportRuntime: BrowserRuntime["getCookieImportRuntime"];
  declare readonly getAutomationRuntime: BrowserRuntime["getAutomationRuntime"];
  declare readonly closeAutomationTab: BrowserRuntime["closeAutomationTab"];
  declare readonly open: BrowserRuntime["open"];
  declare readonly close: BrowserRuntime["close"];
  declare readonly hide: BrowserRuntime["hide"];
  declare readonly getState: BrowserRuntime["getState"];
  declare readonly setPanelBounds: BrowserRuntime["setPanelBounds"];
  declare readonly attachWebview: BrowserRuntime["attachWebview"];
  declare readonly detachWebview: BrowserRuntime["detachWebview"];
  declare readonly navigate: BrowserRuntime["navigate"];
  declare readonly reload: BrowserRuntime["reload"];
  declare readonly goBack: BrowserRuntime["goBack"];
  declare readonly goForward: BrowserRuntime["goForward"];
  declare readonly newTab: BrowserRuntime["newTab"];
  declare readonly closeTab: BrowserRuntime["closeTab"];
  declare readonly selectTab: BrowserRuntime["selectTab"];
  declare readonly openDevTools: BrowserRuntime["openDevTools"];
  declare readonly captureScreenshot: BrowserRuntime["captureScreenshot"];
  declare readonly capturePreview: BrowserRuntime["capturePreview"];
  declare readonly copyLink: BrowserRuntime["copyLink"];
  declare readonly copyScreenshotToClipboard: BrowserRuntime["copyScreenshotToClipboard"];
  constructor(options: DesktopBrowserManagerOptions = {}) {
    Object.assign(this, createBrowserRuntime(options));
  }
}
