import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  BrowserCopyLinkEvent,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserTabInput,
  BrowserTabState,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import {
  normalizeBrowserUrlInput as normalizeUrlInput,
  resolveCopyableBrowserTabUrl,
} from "@glade/shared/browser/browserSession";
import { clipboard } from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  buildRuntimeKey,
  canWebContentsGoBack,
  canWebContentsGoForward,
  createBrowserTab,
  defaultTitleForUrl,
  isAbortedNavigationError,
  LiveTabRuntime,
  syncTabStateFromRuntime,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserTabNavigation(
  hostRuntime: Pick<
    BrowserRuntime,
    | "services"
    | "budget"
    | "live"
    | "tabs"
    | "view"
    | "markHumanControl"
    | "markThreadStateChanged"
    | "getVisibleBoundsForThread"
    | "attachRuntime"
    | "ensureLiveRuntime"
    | "clearSuspendTimer"
    | "snapshotThreadState"
    | "resumeThread"
    | "getState"
    | "attachActiveTab"
    | "closePopupWindowsForTab"
    | "destroyRuntime"
    | "close"
    | "queueRuntimeStateSync"
    | "getOrCreateState"
  >,
) {
  function navigate(input: BrowserNavigateInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    const tab = resolveTab(state, input.tabId);
    const nextUrl = normalizeUrlInput(input.url);
    tab.url = nextUrl;
    tab.title = defaultTitleForUrl(nextUrl);
    tab.lastCommittedUrl = null;
    tab.lastError = null;
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);

    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, tab.id));
    if (runtime) {
      const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) {
        hostRuntime.attachRuntime(runtime, bounds);
      }
      void loadTab(input.threadId, tab.id, { force: true, runtime });
    } else if (
      hostRuntime.view.activeThreadId === input.threadId &&
      !hostRuntime.live.rendererOnlyRuntimeKeys.has(buildRuntimeKey(input.threadId, tab.id))
    ) {
      const nextRuntime = hostRuntime.ensureLiveRuntime(input.threadId, tab.id);
      hostRuntime.clearSuspendTimer(input.threadId);
      const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) {
        hostRuntime.attachRuntime(nextRuntime, bounds);
      }
      void loadTab(input.threadId, tab.id, { force: true, runtime: nextRuntime });
    }

    emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function reload(input: BrowserTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    const tab = resolveTab(state, input.tabId);
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, tab.id));
    if (runtime) {
      runtime.webContents.reload();
    } else if (hostRuntime.view.activeThreadId === input.threadId) {
      hostRuntime.resumeThread(input.threadId);
      void loadTab(input.threadId, tab.id, { force: true });
    }
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function goBack(input: BrowserTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
    if (runtime && canWebContentsGoBack(runtime.webContents)) {
      runtime.webContents.goBack();
    }
    return hostRuntime.getState({ threadId: input.threadId });
  }

  function goForward(input: BrowserTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
    if (runtime && canWebContentsGoForward(runtime.webContents)) {
      runtime.webContents.goForward();
    }
    return hostRuntime.getState({ threadId: input.threadId });
  }

  function newTab(input: BrowserNewTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    const tab = createBrowserTab(normalizeUrlInput(input.url));
    state.tabs = [...state.tabs, tab];
    if (input.activate !== false || !state.activeTabId) {
      state.activeTabId = tab.id;
    }

    if (hostRuntime.view.activeThreadId === input.threadId) {
      hostRuntime.resumeThread(input.threadId);
      const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) {
        hostRuntime.attachActiveTab(input.threadId, bounds, { forceLoad: true });
      }
    } else {
      tab.status = "suspended";
    }

    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);
    emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function closeTab(input: BrowserTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    let nextTabs = state.tabs.filter((tab) => tab.id !== input.tabId);
    if (nextTabs.length === state.tabs.length) {
      return hostRuntime.snapshotThreadState(input.threadId, state);
    }

    hostRuntime.closePopupWindowsForTab(input.threadId, input.tabId);
    hostRuntime.destroyRuntime(input.threadId, input.tabId);
    hostRuntime.services.annotations.clearProjection(input.threadId, input.tabId);
    hostRuntime.live.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    hostRuntime.live.automationRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    state.tabs = state.tabs.filter((tab) => tab.id !== input.tabId);

    nextTabs = state.tabs;

    if (nextTabs.length === 0) {
      return hostRuntime.close({ threadId: input.threadId });
    }

    if (!state.activeTabId || state.activeTabId === input.tabId) {
      state.activeTabId = nextTabs[Math.max(0, nextTabs.length - 1)]?.id ?? null;
    }

    const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
    if (hostRuntime.view.activeThreadId === input.threadId && bounds) {
      hostRuntime.attachActiveTab(input.threadId, bounds);
    }

    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);
    emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function selectTab(input: BrowserTabInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    const tab = resolveTab(state, input.tabId);
    activateTab(input.threadId, state, tab);

    if (hostRuntime.view.activeThreadId === input.threadId) {
      hostRuntime.resumeThread(input.threadId);
      const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
      if (bounds) {
        hostRuntime.attachActiveTab(input.threadId, bounds);
      }
    }

    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function openDevTools(input: BrowserTabInput): void {
    hostRuntime.markHumanControl(input.threadId);
    const state = ensureWorkspace(input.threadId);
    const tab = resolveTab(state, input.tabId);
    activateTab(input.threadId, state, tab);

    hostRuntime.resumeThread(input.threadId);
    const runtime = hostRuntime.ensureLiveRuntime(input.threadId, tab.id);
    const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
    if (bounds) {
      hostRuntime.attachActiveTab(input.threadId, bounds);
    }
    runtime.webContents.openDevTools({ mode: "detach" });
  }

  async function loadTab(
    threadId: ThreadId,
    tabId: string,
    options: { force?: boolean; runtime?: LiveTabRuntime } = {},
  ): Promise<void> {
    const state = ensureWorkspace(threadId);
    const tab = getTab(state, tabId);
    if (!tab) {
      return;
    }

    const runtime = options.runtime ?? hostRuntime.ensureLiveRuntime(threadId, tabId);
    const webContents = runtime.webContents;
    const nextUrl = normalizeUrlInput(
      options.force === true ? tab.url : (tab.lastCommittedUrl ?? tab.url),
    );
    const currentUrl = hostRuntime.services.sessionPolicy.resolveDisplayUrl(webContents.getURL());
    const shouldLoad = options.force === true || currentUrl !== nextUrl || currentUrl.length === 0;

    if (!shouldLoad) {
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
      return;
    }

    tab.url = nextUrl;
    tab.status = "live";
    tab.isLoading = true;
    tab.lastError = null;
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(threadId);
    emitState(threadId);

    try {
      await webContents.loadURL(hostRuntime.services.sessionPolicy.resolveRuntimeUrl(nextUrl));
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
    } catch (error) {
      if (isAbortedNavigationError(error)) {
        hostRuntime.queueRuntimeStateSync(threadId, tabId);
        return;
      }

      tab.isLoading = false;
      tab.lastError = "Couldn't open this page.";
      syncThreadLastError(state);
      hostRuntime.markThreadStateChanged(threadId);
      emitState(threadId);
    }
  }

  function syncRuntimeState(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    hostRuntime.budget.perfCounters.syncRuntimeStateCalls += 1;
    const state = hostRuntime.tabs.states.get(threadId);
    const tab = state ? getTab(state, tabId) : null;
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(threadId, tabId));
    if (!state || !tab || !runtime) {
      return;
    }

    const didChange = syncTabStateFromRuntime(
      state,
      tab,
      runtime.webContents,
      (url) => hostRuntime.services.sessionPolicy.resolveDisplayUrl(url),
      faviconUrls,
    );
    const nextDidChange = syncThreadLastError(state) || didChange;
    if (nextDidChange) {
      hostRuntime.markThreadStateChanged(threadId);
      emitState(threadId);
    }
  }

  function ensureWorkspace(threadId: ThreadId, initialUrl?: string): ThreadBrowserState {
    hostRuntime.services.sessionPolicy.ensureConfigured();
    const state = hostRuntime.getOrCreateState(threadId);
    if (state.tabs.length === 0) {
      const initialTab = createBrowserTab(normalizeUrlInput(initialUrl));
      state.tabs = [initialTab];
      state.activeTabId = initialTab.id;
    }

    if (!state.activeTabId || !state.tabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null;
    }

    return state;
  }

  function resolveTab(state: ThreadBrowserState, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId;
    const existing =
      (resolvedTabId ? state.tabs.find((tab) => tab.id === resolvedTabId) : undefined) ??
      state.tabs[0];
    if (existing) {
      return existing;
    }

    const fallback = createBrowserTab();
    state.tabs = [fallback];
    state.activeTabId = fallback.id;
    return fallback;
  }

  function activateTab(threadId: ThreadId, state: ThreadBrowserState, tab: BrowserTabState): void {
    if (state.activeTabId === tab.id) {
      return;
    }

    state.activeTabId = tab.id;
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(threadId);
    emitState(threadId);
  }

  function getActiveTab(state: ThreadBrowserState): BrowserTabState | null {
    if (!state.activeTabId) {
      return state.tabs[0] ?? null;
    }
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
  }

  function getTab(state: ThreadBrowserState, tabId: string): BrowserTabState | null {
    return state.tabs.find((tab) => tab.id === tabId) ?? null;
  }

  function resolveCopyableTabUrl(
    threadId: ThreadId,
    tabId: string,
    runtime: LiveTabRuntime | undefined,
  ): string | null {
    const state = hostRuntime.tabs.states.get(threadId);
    const tab = state ? getTab(state, tabId) : null;
    const liveUrl =
      runtime && !runtime.webContents.isDestroyed() ? runtime.webContents.getURL() : null;
    return resolveCopyableBrowserTabUrl(tab, liveUrl);
  }

  function copyTabLink(threadId: ThreadId, tabId: string): void {
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(threadId, tabId));
    const url = resolveCopyableTabUrl(threadId, tabId, runtime);
    if (!url) {
      return;
    }
    clipboard.writeText(url);
    const event: BrowserCopyLinkEvent = { threadId, url };
    for (const listener of hostRuntime.tabs.copyLinkListeners) {
      listener(event);
    }
  }

  function emitState(threadId: ThreadId): void {
    hostRuntime.budget.perfCounters.stateEmitCalls += 1;
    const state = hostRuntime.getOrCreateState(threadId);
    const nextVersion = state.version;
    if (hostRuntime.tabs.lastEmittedVersionByThreadId.get(threadId) === nextVersion) {
      hostRuntime.budget.perfCounters.stateEmitSkips += 1;
      return;
    }
    hostRuntime.tabs.lastEmittedVersionByThreadId.set(threadId, nextVersion);
    const snapshot = hostRuntime.snapshotThreadState(threadId, state);
    for (const listener of hostRuntime.tabs.listeners) {
      listener(snapshot);
    }
  }

  return {
    navigate,
    reload,
    goBack,
    goForward,
    newTab,
    closeTab,
    selectTab,
    openDevTools,
    loadTab,
    syncRuntimeState,
    ensureWorkspace,
    resolveTab,
    activateTab,
    getActiveTab,
    getTab,
    copyTabLink,
    emitState,
  };
}
