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
  BrowserPanelBounds,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import type { WebContents } from "electron";
import { BrowserWindow } from "electron";
import {
  BrowserAnnotationCoordinator,
  type BrowserAnnotationRuntime,
} from "./annotations/coordinator";
import { BrowserSessionPolicy, type BrowserSessionDownloadEvent } from "./browserSessionPolicy";
import {
  BrowserAutomationDownloadEvent,
  BrowserAutomationDownloadListener,
  BrowserAutomationExpectedInput,
  BrowserAutomationPrepareNavigationInput,
  BrowserAutomationPrepareTabInput,
  BrowserAutomationSideEffectProvenance,
  BrowserAutomationVisibleRuntime,
  BrowserAutomationWindowOpenEvent,
  BrowserAutomationWindowOpenListener,
  BrowserCopyLinkListener,
  BrowserHumanControlListener,
  BrowserPerformanceSnapshot,
  BrowserStateListener,
  DesktopBrowserManagerOptions,
  EmbeddedPopupOptions,
  LiveTabRuntime,
  OAuthPopupContext,
  OAuthPopupRuntime,
  PendingAutomationWindowOpenCommit,
  PendingRuntimeSync,
  PendingStatePublication,
  PendingWindowOpenTask,
} from "./browserTabState";

interface BrowserViewState {
  window: BrowserWindow | null;
  activeThreadId: ThreadId | null;
  activeBounds: BrowserPanelBounds | null;
  activeBoundsThreadId: ThreadId | null;
  activePageZoomFactor: number;
  activePageZoomThreadId: ThreadId | null;
  attachedRuntimeKey: string | null;
  attachedBoundsSignature: string | null;
}

interface BrowserTabsState {
  states: Map<ThreadId, ThreadBrowserState>;
  threadVersionById: Map<ThreadId, number>;
  snapshotCacheByThreadId: Map<ThreadId, { version: number; snapshot: ThreadBrowserState }>;
  lastEmittedVersionByThreadId: Map<ThreadId, number>;
  pendingStatePublicationsByKey: Map<string, PendingStatePublication>;
  listeners: Set<BrowserStateListener>;
  copyLinkListeners: Set<BrowserCopyLinkListener>;
  previewThreadIds: Set<ThreadId>;
}

interface BrowserLiveState {
  runtimes: Map<string, LiveTabRuntime>;
  runtimePageZoomFactors: Map<string, number>;
  rendererOnlyRuntimeKeys: Set<string>;
  automationRuntimeKeys: Set<string>;
  pendingRuntimeSyncs: Map<string, PendingRuntimeSync>;
  runtimeSyncFlushScheduled: boolean;
  popupRuntimes: Map<BrowserWindow, OAuthPopupRuntime>;
}

interface BrowserBudgetState {
  automationRuntimeProtectedUntilByKey: Map<string, number>;
  runtimeLastActiveAtByKey: Map<string, number>;
  tabSuspendTimers: Map<string, NodeJS.Timeout>;
  suspendTimers: Map<ThreadId, NodeJS.Timeout>;
  backgroundAutomationEvictionTimer: NodeJS.Timeout | null;
  perfCounters: BrowserPerformanceSnapshot["counters"];
}

interface BrowserPopupState {
  pendingWindowOpenTasksByRuntimeKey: Map<string, PendingWindowOpenTask>;
  pendingAutomationWindowOpenCommitsByRuntimeKey: Map<string, PendingAutomationWindowOpenCommit>;
}

interface BrowserServicesState {
  options: DesktopBrowserManagerOptions;
  annotations: BrowserAnnotationCoordinator;
  sessionPolicy: BrowserSessionPolicy;
}

interface BrowserLifecycleState {
  disposed: boolean;
}

export interface BrowserRuntime {
  configureRuntimeWebContents: (runtime: LiveTabRuntime) => void;
  configureOAuthPopupRuntime: (runtime: OAuthPopupRuntime) => void;
  readonly view: BrowserViewState;
  readonly tabs: BrowserTabsState;
  readonly live: BrowserLiveState;
  readonly budget: BrowserBudgetState;
  readonly popup: BrowserPopupState;
  readonly services: BrowserServicesState;
  readonly lifecycle: BrowserLifecycleState;
  setWindow: (window: BrowserWindow | null) => void;
  isWebMcpCompatibilityAllowed: (webContentsId: number) => boolean;
  subscribe: (listener: BrowserStateListener) => () => void;
  subscribeCopyLink: (listener: BrowserCopyLinkListener) => () => void;
  subscribeAnnotationEvents: (listener: (event: BrowserAnnotationEvent) => void) => () => void;
  startAnnotation: (input: BrowserAnnotationStartInput) => BrowserAnnotationSession;
  cancelAnnotation: (input: BrowserAnnotationCancelInput) => void;
  syncAnnotationMarkers: (input: BrowserAnnotationSyncMarkersInput) => void;
  resolveAnnotationNavigationTarget: (input: {
    threadId: ThreadId;
    tabId?: string;
    annotationId: string;
  }) => { readonly tabId: string; readonly url: string } | null;
  handleAnnotationGuestMessage: (sender: WebContents, payload: unknown) => void;
  isAnnotationInteractive: (threadId: ThreadId) => boolean;
  isTrustedRenderer: (webContentsId: number) => boolean;
  trackAutomationWindowOpen: (
    input: BrowserTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ) => () => void;
  trackAutomationDownload: (
    input: BrowserTabInput,
    listener: BrowserAutomationDownloadListener,
  ) => () => void;
  configureWindowOpenHandling: (
    webContents: WebContents,
    context: OAuthPopupContext,
    listenerDisposers: Array<() => void>,
  ) => void;
  closeEmbeddedPopup: (runtime: LiveTabRuntime) => void;
  isEmbeddedPopupFamily: (threadId: ThreadId, tabId: string) => boolean;
  handleSessionDownload: (input: BrowserSessionDownloadEvent) => void;
  commitPendingAutomationWindowOpen: (key: string) => void;
  scheduleDeferredStatePublication: (
    key: string,
    threadId: ThreadId,
    reattachActiveTab: boolean,
    rendererGuestToReset?: WebContents,
    initialNavigationTabId?: string,
  ) => void;
  clearPendingWindowOpenTask: (threadId: ThreadId, tabId: string) => void;
  clearAllPendingWindowOpenTasks: () => void;
  updatePopupWindowsForThread: (threadId: ThreadId) => void;
  closePopupWindowsForThread: (threadId: ThreadId) => void;
  closePopupWindowsForTab: (threadId: ThreadId, tabId: string) => void;
  closeAllPopupWindows: () => void;
  dispose: () => void;
  getPerformanceSnapshot: () => BrowserPerformanceSnapshot;
  clearAutomationState: () => void;
  clearAutomationRuntimeTracking: (key: string, preserveDownloadTracking: boolean) => void;
  hasAutomationDownloadTracking: (key: string) => boolean;
  getAutomationSideEffectProvenance: (
    key: string,
  ) => BrowserAutomationSideEffectProvenance | undefined;
  inheritAutomationSideEffectProvenance: (
    sourceKey: string,
    childKey: string,
    epoch: number,
  ) => void;
  getAutomationHumanControlEpoch: (threadId: ThreadId) => number;
  isHumanBrowserOperationActive: () => boolean;
  beginHumanBrowserOperation: () => () => void;
  subscribeAutomationHumanControl: (
    threadId: ThreadId,
    listener: BrowserHumanControlListener,
  ) => () => void;
  prepareAutomationTab: (input: BrowserAutomationPrepareTabInput) => ThreadBrowserState;
  selectAutomationTab: (input: BrowserTabInput) => ThreadBrowserState;
  prepareAutomationNavigation: (
    input: BrowserAutomationPrepareNavigationInput,
  ) => ThreadBrowserState;
  getVisibleAutomationRuntime: (input: BrowserTabInput) => BrowserAutomationVisibleRuntime;
  getCookieImportRuntime: (input: BrowserTabInput) => Promise<BrowserAutomationVisibleRuntime>;
  getAutomationRuntime: (
    input: BrowserTabInput,
    options?: { readonly restore?: boolean },
  ) => Promise<BrowserAutomationVisibleRuntime>;
  closeAutomationTab: (input: BrowserTabInput) => ThreadBrowserState;
  open: (input: BrowserOpenInput) => ThreadBrowserState;
  close: (input: BrowserThreadInput) => ThreadBrowserState;
  hide: (input: BrowserThreadInput) => void;
  getState: (input: BrowserThreadInput) => ThreadBrowserState;
  setPanelBounds: (input: BrowserSetPanelBoundsInput) => void;
  attachWebview: (
    input: BrowserAttachWebviewInput,
    hostWebContentsId: number,
  ) => ThreadBrowserState;
  detachWebview: (input: BrowserDetachWebviewInput) => void;
  navigate: (input: BrowserNavigateInput) => ThreadBrowserState;
  reload: (input: BrowserTabInput) => ThreadBrowserState;
  goBack: (input: BrowserTabInput) => ThreadBrowserState;
  goForward: (input: BrowserTabInput) => ThreadBrowserState;
  newTab: (input: BrowserNewTabInput) => ThreadBrowserState;
  closeTab: (input: BrowserTabInput) => ThreadBrowserState;
  selectTab: (input: BrowserTabInput) => ThreadBrowserState;
  openDevTools: (input: BrowserTabInput) => void;
  captureScreenshot: (input: BrowserTabInput) => Promise<BrowserCaptureScreenshotResult>;
  capturePreview: (input: BrowserTabInput) => Promise<string | null>;
  copyLink: (input: BrowserTabInput) => void;
  copyScreenshotToClipboard: (input: BrowserTabInput) => Promise<void>;
  isNativeAutomationTab: (threadId: ThreadId, tabId: string) => boolean;
  promoteTabToRendererSurface: (threadId: ThreadId, tabId: string) => void;
  activateThreadForPendingRenderer: (
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    pageZoomFactor?: number,
  ) => void;
  getVisibleBoundsForThread: (threadId: ThreadId) => BrowserPanelBounds | null;
  getVisiblePageZoomFactor: (threadId: ThreadId) => number;
  setRuntimePageZoomFactor: (runtime: LiveTabRuntime, pageZoomFactor: number) => void;
  resumeThread: (threadId: ThreadId) => void;
  noteAutomationRuntimeUse: (key: string) => void;
  enforceBackgroundAutomationRuntimeBudget: () => void;
  suspendInactiveTabs: (threadId: ThreadId, activeTabId: string | null) => boolean;
  scheduleThreadSuspend: (threadId: ThreadId) => void;
  clearSuspendTimer: (threadId: ThreadId) => void;
  clearTabSuspendTimer: (threadId: ThreadId, tabId: string) => void;
  attachActiveTab: (
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    options?: { forceLoad?: boolean; pageZoomFactor?: number },
  ) => void;
  attachRuntime: (
    runtime: LiveTabRuntime,
    bounds: BrowserPanelBounds,
    pageZoomFactor?: number,
  ) => void;
  detachAttachedRuntime: () => void;
  setRuntimeViewHidden: (runtime: LiveTabRuntime, hidden: boolean) => void;
  parkHiddenRuntime: (runtime: LiveTabRuntime, bounds: BrowserPanelBounds) => void;
  ensureLiveRuntime: (threadId: ThreadId, tabId: string) => LiveTabRuntime;
  claimAutomationTab: (threadId: ThreadId, tab: BrowserTabState) => boolean;
  createLiveRuntime: (
    threadId: ThreadId,
    tabId: string,
    popupOptions?: EmbeddedPopupOptions,
  ) => LiveTabRuntime;
  loadTab: (
    threadId: ThreadId,
    tabId: string,
    options?: { force?: boolean; runtime?: LiveTabRuntime },
  ) => Promise<void>;
  syncRuntimeState: (threadId: ThreadId, tabId: string, faviconUrls?: string[]) => void;
  queueRuntimeStateSync: (threadId: ThreadId, tabId: string, faviconUrls?: string[]) => void;
  destroyThreadRuntimes: (threadId: ThreadId) => void;
  destroyAllRuntimes: () => void;
  destroyRuntime: (
    threadId: ThreadId,
    tabId: string,
    options?: {
      readonly preserveRendererDebugger?: boolean;
      readonly preserveAutomationDownloadTracking?: boolean;
      readonly annotationReason?: "detached" | "destroyed" | "replaced";
    },
  ) => void;
  findRendererRuntimeByWebContentsId: (webContentsId: number) => LiveTabRuntime | null;
  findRuntimeByWebContentsId: (webContentsId: number) => LiveTabRuntime | null;
  toAnnotationRuntime: (runtime: LiveTabRuntime | null) => BrowserAnnotationRuntime | null;
  getOrCreateState: (threadId: ThreadId) => ThreadBrowserState;
  markThreadStateChanged: (threadId: ThreadId) => void;
  markHumanControl: (threadId: ThreadId) => void;
  expectAutomationInput: (
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ) => () => void;
  isAutomationGestureActive: (threadId: ThreadId, tabId: string) => boolean;
  emitAutomationWindowOpen: (event: BrowserAutomationWindowOpenEvent) => void;
  emitAutomationDownload: (event: BrowserAutomationDownloadEvent) => void;
  consumeExpectedAutomationInput: (
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ) => boolean;
  snapshotThreadState: (threadId: ThreadId, state?: ThreadBrowserState) => ThreadBrowserState;
  getTrackedProcessIds: () => number[];
  countWarmInactiveRuntimes: () => number;
  ensureWorkspace: (threadId: ThreadId, initialUrl?: string) => ThreadBrowserState;
  resolveTab: (state: ThreadBrowserState, tabId?: string) => BrowserTabState;
  activateTab: (threadId: ThreadId, state: ThreadBrowserState, tab: BrowserTabState) => void;
  getActiveTab: (state: ThreadBrowserState) => BrowserTabState | null;
  getTab: (state: ThreadBrowserState, tabId: string) => BrowserTabState | null;
  copyTabLink: (threadId: ThreadId, tabId: string) => void;
  emitState: (threadId: ThreadId) => void;
}
