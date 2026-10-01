import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  BrowserCopyLinkEvent,
  BrowserPanelBounds,
  BrowserTabInput,
  BrowserTabState,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  BROWSER_AUTOMATION_VIEWPORT_HEIGHT,
  BROWSER_AUTOMATION_VIEWPORT_WIDTH,
} from "@glade/shared/browser/browserSession";
import type { WebContents } from "electron";
import { BrowserWindow, WebContentsView } from "electron";
import * as Crypto from "node:crypto";
import { isLocalHtmlPreviewUrl, isSameLocalHtmlPreviewGrant } from "./localHtmlPreviewProtocol";
export const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS = 1_500;

export const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS = 400;

export const BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD = 1;

export const BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES = 4;

export const BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS = 31_000;

export const BROWSER_THREAD_SUSPEND_DELAY_MS = 30_000;

export const BROWSER_AUTOMATION_WINDOW_OPEN_FALLBACK_MS = 2_000;

export const BROWSER_DEFERRED_PUBLICATION_DELAY_MS = 16;

export const BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS = 100;

export const BROWSER_ERROR_ABORTED = -3;

export type BrowserStateListener = (state: ThreadBrowserState) => void;

export type BrowserCopyLinkListener = (event: BrowserCopyLinkEvent) => void;

export type BrowserHumanControlListener = () => void;

export type BrowserAutomationWindowOpenListener = (event: BrowserAutomationWindowOpenEvent) => void;

export type BrowserAutomationDownloadListener = (event: BrowserAutomationDownloadEvent) => void;

export type BrowserAutomationExpectedInput =
  | {
      readonly kind: "key";
      readonly key: string;
      readonly alt: boolean;
      readonly control: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    }
  | {
      readonly kind: "mouse";
      readonly type: "mouseDown" | "mouseWheel" | "contextMenu";
      readonly x: number;
      readonly y: number;
      readonly button?: "left" | "middle" | "right";
    };

export interface PendingBrowserAutomationInput {
  readonly signal: BrowserAutomationExpectedInput;
  expiresAt: number;
}

export interface BrowserAutomationDownloadLease {
  readonly listener: BrowserAutomationDownloadListener;
  readonly humanControlEpoch: number;
}

export interface BrowserAutomationSideEffectProvenance {
  readonly threadId: ThreadId;
  readonly humanControlEpoch: number;
}

export interface LiveTabRuntime {
  key: string;
  threadId: ThreadId;
  tabId: string;
  webContents: WebContents;
  view: WebContentsView | null;
  ownsWebContents: boolean;
  listenerDisposers: Array<() => void>;
  popupOpenerTabId?: string;
}

export interface OAuthPopupContext {
  threadId: ThreadId;
  tabId: string;
}

export interface OAuthPopupRuntime extends OAuthPopupContext {
  window: BrowserWindow;
  listenerDisposers: Array<() => void>;
}

export interface NativeBrowserViewVisibility {
  setVisible?: (visible: boolean) => void;
}

export interface PendingRuntimeSync {
  threadId: ThreadId;
  tabId: string;
  faviconUrls?: string[];
}

export interface PendingWindowOpenTask {
  readonly handle: ReturnType<typeof setImmediate>;
  readonly sourceWebContents: WebContents;
}

export interface PendingAutomationWindowOpenCommit {
  readonly threadId: ThreadId;
  readonly sourceTabId: string;
  readonly sourceWebContents: WebContents;
  readonly tab: BrowserTabState;
  readonly fallbackTimer: ReturnType<typeof setTimeout>;
}

export interface PendingStatePublication {
  readonly handle: ReturnType<typeof setTimeout>;
  readonly threadId: ThreadId;
  readonly reattachActiveTab: boolean;
  readonly initialNavigationTabId?: string;
  readonly rendererGuestToReset?: WebContents;
}

export const LIVE_TAB_STATUS: BrowserTabState["status"] = "live";

export const SUSPENDED_TAB_STATUS: BrowserTabState["status"] = "suspended";

export const BACKGROUND_AUTOMATION_BOUNDS: BrowserPanelBounds = {
  x: 0,
  y: 0,
  width: BROWSER_AUTOMATION_VIEWPORT_WIDTH,
  height: BROWSER_AUTOMATION_VIEWPORT_HEIGHT,
};

export interface BrowserPerformanceSnapshot {
  counters: {
    setPanelBoundsCalls: number;
    setPanelBoundsNoopSkips: number;
    setPanelBoundsViewportUpdates: number;
    stateEmitCalls: number;
    stateEmitSkips: number;
    stateCloneCount: number;
    runtimeSyncQueueFlushes: number;
    syncRuntimeStateCalls: number;
    inactiveTabSuspendScheduled: number;
    inactiveTabSuspendCancelled: number;
    inactiveTabBudgetEvictions: number;
    warmInactiveRuntimeCount: number;
  };
  trackedProcessIds: number[];
}

export interface BrowserAutomationVisibleRuntime {
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly webContents: WebContents;
  // The returned disposer must be called once the dispatch has drained so a stale expected signal can
  // never mask a later human action.
  readonly expectAgentInput?: (signal: BrowserAutomationExpectedInput) => () => void;
}

export interface BrowserAutomationPrepareTabInput {
  readonly threadId: ThreadId;
  readonly url?: string;
  readonly reuse: boolean;
}

export interface BrowserAutomationPrepareNavigationInput extends BrowserTabInput {
  readonly url: string;
}

export interface BrowserAutomationWindowOpenEvent {
  readonly threadId: ThreadId;
  readonly sourceTabId: string;
  readonly kind: "tab" | "popup" | "blocked";
  readonly openedTabId: string | null;
}

export interface BrowserAutomationDownloadEvent {
  readonly threadId: ThreadId;
  readonly sourceTabId: string;
}

export interface DesktopBrowserManagerOptions {
  onRuntimeReady?: (runtime: BrowserAutomationVisibleRuntime) => () => void;
  onHumanControl?: (threadId: ThreadId) => void;
  beforeInputEvent?: (event: Electron.Event, input: Electron.Input) => boolean;
  annotationPreloadPath?: string;
}

export function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: Crypto.randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    runtimeSurface: "native",
    status: SUSPENDED_TAB_STATUS,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  };
}

export function defaultThreadBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

export function cloneThreadState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
  };
}

export function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return "New tab";
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

export function screenshotFileNameForUrl(url: string): string {
  const fallback = "browser";
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    const normalizedHost = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${normalizedHost || fallback}-${Date.now()}.png`;
  } catch {
    return `${fallback}-${Date.now()}.png`;
  }
}

export function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) return null;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null;
  }

  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  if (width === 0 || height === 0) {
    return null;
  }

  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  };
}

export function isAbortedNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /ERR_ABORTED|\(-3\)/i.test(error.message);
}

export function mapBrowserLoadError(errorCode: number): string {
  switch (errorCode) {
    case -102:
      return "Connection refused.";
    case -105:
      return "Couldn't resolve this address.";
    case -106:
      return "You're offline.";
    case -118:
      return "This page took too long to respond.";
    case -137:
      return "A secure connection couldn't be established.";
    case -200:
      return "A secure connection couldn't be established.";
    default:
      return "Couldn't open this page.";
  }
}

export function buildRuntimeKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}:${tabId}`;
}

function browserBoundsSignature(bounds: BrowserPanelBounds | null): string {
  if (!bounds) {
    return "hidden";
  }

  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
}

export function browserPresentationSignature(
  bounds: BrowserPanelBounds | null,
  pageZoomFactor: number,
): string {
  return `${browserBoundsSignature(bounds)}:zoom-${pageZoomFactor}`;
}

export function isAllowedBrowserRuntimeNavigation(url: string, currentUrl: string): boolean {
  if (url === ABOUT_BLANK_URL) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return true;
    }
    return isLocalHtmlPreviewUrl(url) && isSameLocalHtmlPreviewGrant(currentUrl, url);
  } catch {
    return false;
  }
}

function normalizeAutomationKey(value: string): string {
  if (value === "Space" || value === "Spacebar" || value === " ") {
    return " ";
  }
  return value.toLocaleLowerCase("en-US");
}

export function browserAutomationInputMatches(
  expected: BrowserAutomationExpectedInput,
  actual: BrowserAutomationExpectedInput,
): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "key" && actual.kind === "key") {
    return (
      normalizeAutomationKey(expected.key) === normalizeAutomationKey(actual.key) &&
      expected.alt === actual.alt &&
      expected.control === actual.control &&
      expected.meta === actual.meta &&
      expected.shift === actual.shift
    );
  }
  if (expected.kind !== "mouse" || actual.kind !== "mouse") return false;
  return (
    expected.type === actual.type &&
    (expected.button === undefined || expected.button === actual.button) &&
    Math.abs(expected.x - actual.x) <= 1.5 &&
    Math.abs(expected.y - actual.y) <= 1.5
  );
}

export type EmbeddedPopupOptions = Electron.BrowserWindowConstructorOptions & {
  webContents?: WebContents;
};

function setIfChanged<T>(current: T, next: T, apply: (value: T) => void): boolean {
  if (Object.is(current, next)) {
    return false;
  }
  apply(next);
  return true;
}

export function suspendTabState(tab: BrowserTabState): boolean {
  let didChange = false;
  didChange =
    setIfChanged(tab.status, SUSPENDED_TAB_STATUS, (value) => {
      tab.status = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.isLoading, false, (value) => {
      tab.isLoading = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoBack, false, (value) => {
      tab.canGoBack = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoForward, false, (value) => {
      tab.canGoForward = value;
    }) || didChange;
  return didChange;
}

export function syncTabStateFromRuntime(
  state: ThreadBrowserState,
  tab: BrowserTabState,
  webContents: WebContents,
  resolveDisplayUrl: (url: string) => string,
  faviconUrls?: string[],
): boolean {
  const currentUrl = resolveDisplayUrl(webContents.getURL());
  const nextUrl = currentUrl || tab.url;
  const nextTitle = webContents.getTitle();
  let didChange = false;
  didChange =
    setIfChanged(tab.status, LIVE_TAB_STATUS, (value) => {
      tab.status = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.url, nextUrl, (value) => {
      tab.url = value;
    }) || didChange;
  const resolvedTitle =
    !nextTitle || nextTitle === ABOUT_BLANK_URL ? defaultTitleForUrl(nextUrl) : nextTitle;
  didChange =
    setIfChanged(tab.title, resolvedTitle, (value) => {
      tab.title = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.isLoading, webContents.isLoading(), (value) => {
      tab.isLoading = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoBack, canWebContentsGoBack(webContents), (value) => {
      tab.canGoBack = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.canGoForward, canWebContentsGoForward(webContents), (value) => {
      tab.canGoForward = value;
    }) || didChange;
  didChange =
    setIfChanged(tab.lastCommittedUrl, currentUrl || tab.lastCommittedUrl, (value) => {
      tab.lastCommittedUrl = value;
    }) || didChange;
  if (faviconUrls) {
    didChange =
      setIfChanged(tab.faviconUrl, faviconUrls[0] ?? tab.faviconUrl, (value) => {
        tab.faviconUrl = value;
      }) || didChange;
  }
  didChange = syncThreadLastError(state) || didChange;
  return didChange;
}

export function canWebContentsGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack();
}

export function canWebContentsGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward();
}

export function syncThreadLastError(state: ThreadBrowserState): boolean {
  const activeTab =
    (state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined) ??
    state.tabs[0];
  const nextLastError = activeTab?.lastError ?? null;
  if (state.lastError === nextLastError) {
    return false;
  }
  state.lastError = nextLastError;
  return true;
}
