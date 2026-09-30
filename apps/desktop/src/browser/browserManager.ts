import type {
  BrowserAnnotationCancelInput,
  BrowserAnnotationEvent,
  BrowserAnnotationSession,
  BrowserAnnotationStartInput,
  BrowserAnnotationSyncMarkersInput,
} from "@glade/contracts/browser/browserAnnotations";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  BrowserAttachWebviewInput,
  BrowserCaptureScreenshotResult,
  BrowserDetachWebviewInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import { BrowserWindow } from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BrowserAutomationDownloadListener,
  BrowserAutomationPrepareNavigationInput,
  BrowserAutomationPrepareTabInput,
  BrowserAutomationVisibleRuntime,
  BrowserAutomationWindowOpenListener,
  BrowserCopyLinkListener,
  BrowserHumanControlListener,
  BrowserPerformanceSnapshot,
  BrowserStateListener,
  DesktopBrowserManagerOptions,
} from "./browserTabState";
import { createBrowserRuntime } from "./createBrowserRuntime";
export class DesktopBrowserManager {
  private readonly hostRuntime: BrowserRuntime;
  constructor(options: DesktopBrowserManagerOptions = {}) {
    this.hostRuntime = createBrowserRuntime(options);
  }
  setWindow(window: BrowserWindow | null): void {
    return this.hostRuntime.setWindow(window);
  }
  isWebMcpCompatibilityAllowed(webContentsId: number): boolean {
    return this.hostRuntime.isWebMcpCompatibilityAllowed(webContentsId);
  }
  subscribe(listener: BrowserStateListener): () => void {
    return this.hostRuntime.subscribe(listener);
  }
  subscribeCopyLink(listener: BrowserCopyLinkListener): () => void {
    return this.hostRuntime.subscribeCopyLink(listener);
  }
  subscribeAnnotationEvents(listener: (event: BrowserAnnotationEvent) => void): () => void {
    return this.hostRuntime.subscribeAnnotationEvents(listener);
  }
  startAnnotation(input: BrowserAnnotationStartInput): BrowserAnnotationSession {
    return this.hostRuntime.startAnnotation(input);
  }
  cancelAnnotation(input: BrowserAnnotationCancelInput): void {
    return this.hostRuntime.cancelAnnotation(input);
  }
  syncAnnotationMarkers(input: BrowserAnnotationSyncMarkersInput): void {
    return this.hostRuntime.syncAnnotationMarkers(input);
  }
  resolveAnnotationNavigationTarget(input: {
    threadId: ThreadId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly url: string } | null {
    return this.hostRuntime.resolveAnnotationNavigationTarget(input);
  }
  handleAnnotationGuestMessage(sender: Electron.WebContents, payload: unknown): void {
    return this.hostRuntime.handleAnnotationGuestMessage(sender, payload);
  }
  isAnnotationInteractive(threadId: ThreadId): boolean {
    return this.hostRuntime.isAnnotationInteractive(threadId);
  }
  isTrustedRenderer(webContentsId: number): boolean {
    return this.hostRuntime.isTrustedRenderer(webContentsId);
  }
  trackAutomationWindowOpen(
    input: BrowserTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ): () => void {
    return this.hostRuntime.trackAutomationWindowOpen(input, listener);
  }
  trackAutomationDownload(
    input: BrowserTabInput,
    listener: BrowserAutomationDownloadListener,
  ): () => void {
    return this.hostRuntime.trackAutomationDownload(input, listener);
  }
  dispose(): void {
    return this.hostRuntime.dispose();
  }
  getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    return this.hostRuntime.getPerformanceSnapshot();
  }
  getAutomationHumanControlEpoch(threadId: ThreadId): number {
    return this.hostRuntime.getAutomationHumanControlEpoch(threadId);
  }
  isHumanBrowserOperationActive(): boolean {
    return this.hostRuntime.isHumanBrowserOperationActive();
  }
  beginHumanBrowserOperation(): () => void {
    return this.hostRuntime.beginHumanBrowserOperation();
  }
  subscribeAutomationHumanControl(
    threadId: ThreadId,
    listener: BrowserHumanControlListener,
  ): () => void {
    return this.hostRuntime.subscribeAutomationHumanControl(threadId, listener);
  }
  prepareAutomationTab(input: BrowserAutomationPrepareTabInput): ThreadBrowserState {
    return this.hostRuntime.prepareAutomationTab(input);
  }
  selectAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.selectAutomationTab(input);
  }
  prepareAutomationNavigation(input: BrowserAutomationPrepareNavigationInput): ThreadBrowserState {
    return this.hostRuntime.prepareAutomationNavigation(input);
  }
  getVisibleAutomationRuntime(input: BrowserTabInput): BrowserAutomationVisibleRuntime {
    return this.hostRuntime.getVisibleAutomationRuntime(input);
  }
  getCookieImportRuntime(input: BrowserTabInput): Promise<BrowserAutomationVisibleRuntime> {
    return this.hostRuntime.getCookieImportRuntime(input);
  }
  getAutomationRuntime(
    input: BrowserTabInput,
    options?: { readonly restore?: boolean },
  ): Promise<BrowserAutomationVisibleRuntime> {
    return this.hostRuntime.getAutomationRuntime(input, options);
  }
  closeAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.closeAutomationTab(input);
  }
  open(input: BrowserOpenInput): ThreadBrowserState {
    return this.hostRuntime.open(input);
  }
  close(input: BrowserThreadInput): ThreadBrowserState {
    return this.hostRuntime.close(input);
  }
  hide(input: BrowserThreadInput): void {
    return this.hostRuntime.hide(input);
  }
  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.hostRuntime.getState(input);
  }
  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    return this.hostRuntime.setPanelBounds(input);
  }
  attachWebview(input: BrowserAttachWebviewInput, hostWebContentsId: number): ThreadBrowserState {
    return this.hostRuntime.attachWebview(input, hostWebContentsId);
  }
  detachWebview(input: BrowserDetachWebviewInput): void {
    return this.hostRuntime.detachWebview(input);
  }
  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    return this.hostRuntime.navigate(input);
  }
  reload(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.reload(input);
  }
  goBack(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.goBack(input);
  }
  goForward(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.goForward(input);
  }
  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    return this.hostRuntime.newTab(input);
  }
  closeTab(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.closeTab(input);
  }
  selectTab(input: BrowserTabInput): ThreadBrowserState {
    return this.hostRuntime.selectTab(input);
  }
  openDevTools(input: BrowserTabInput): void {
    return this.hostRuntime.openDevTools(input);
  }
  captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    return this.hostRuntime.captureScreenshot(input);
  }
  capturePreview(input: BrowserTabInput): Promise<string | null> {
    return this.hostRuntime.capturePreview(input);
  }
  copyLink(input: BrowserTabInput): void {
    return this.hostRuntime.copyLink(input);
  }
  copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    return this.hostRuntime.copyScreenshotToClipboard(input);
  }
}
