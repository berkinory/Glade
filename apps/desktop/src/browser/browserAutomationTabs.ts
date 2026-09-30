import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserTabInput, ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@glade/shared/browser/browserSession";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BrowserAutomationPrepareNavigationInput,
  BrowserAutomationPrepareTabInput,
  BrowserAutomationVisibleRuntime,
  BrowserHumanControlListener,
  BrowserPerformanceSnapshot,
  buildRuntimeKey,
  createBrowserTab,
  defaultTitleForUrl,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserAutomationTabs(
  hostRuntime: Pick<
    BrowserRuntime,
    | "disposed"
    | "annotations"
    | "sessionPolicy"
    | "clearAllPendingWindowOpenTasks"
    | "suspendTimers"
    | "tabSuspendTimers"
    | "backgroundAutomationEvictionTimer"
    | "detachAttachedRuntime"
    | "destroyAllRuntimes"
    | "closeAllPopupWindows"
    | "pendingRuntimeSyncs"
    | "runtimeLastActiveAtByKey"
    | "rendererOnlyRuntimeKeys"
    | "automationRuntimeKeys"
    | "automationRuntimeProtectedUntilByKey"
    | "listeners"
    | "copyLinkListeners"
    | "states"
    | "previewThreadIds"
    | "threadVersionById"
    | "snapshotCacheByThreadId"
    | "lastEmittedVersionByThreadId"
    | "humanControlEpochByThreadId"
    | "humanControlListenersByThreadId"
    | "expectedAutomationInputsByRuntimeKey"
    | "automationGestureDepthByRuntimeKey"
    | "automationWindowOpenListenersByRuntimeKey"
    | "automationDownloadListenersByRuntimeKey"
    | "automationSideEffectProvenanceByRuntimeKey"
    | "runtimePageZoomFactors"
    | "window"
    | "activeThreadId"
    | "activeBounds"
    | "activeBoundsThreadId"
    | "activePageZoomFactor"
    | "activePageZoomThreadId"
    | "attachedBoundsSignature"
    | "runtimeSyncFlushScheduled"
    | "perfCounters"
    | "countWarmInactiveRuntimes"
    | "getTrackedProcessIds"
    | "humanBrowserOperations"
    | "markHumanControl"
    | "ensureWorkspace"
    | "getActiveTab"
    | "claimAutomationTab"
    | "markThreadStateChanged"
    | "emitState"
    | "snapshotThreadState"
    | "getTab"
    | "runtimes"
    | "attachedRuntimeKey"
    | "getVisibleBoundsForThread"
    | "expectAutomationInput"
    | "clearSuspendTimer"
    | "ensureLiveRuntime"
    | "loadTab"
    | "noteAutomationRuntimeUse"
    | "queueRuntimeStateSync"
    | "closePopupWindowsForTab"
    | "destroyRuntime"
    | "scheduleDeferredStatePublication"
    | "attachActiveTab"
  >,
) {
  function dispose(): void {
    hostRuntime.disposed = true;
    hostRuntime.annotations.dispose();
    hostRuntime.sessionPolicy.dispose();
    hostRuntime.clearAllPendingWindowOpenTasks();
    for (const timer of hostRuntime.suspendTimers.values()) {
      clearTimeout(timer);
    }
    hostRuntime.suspendTimers.clear();
    for (const timer of hostRuntime.tabSuspendTimers.values()) {
      clearTimeout(timer);
    }
    hostRuntime.tabSuspendTimers.clear();
    if (hostRuntime.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(hostRuntime.backgroundAutomationEvictionTimer);
      hostRuntime.backgroundAutomationEvictionTimer = null;
    }
    hostRuntime.detachAttachedRuntime();
    hostRuntime.destroyAllRuntimes();
    hostRuntime.closeAllPopupWindows();
    hostRuntime.pendingRuntimeSyncs.clear();
    hostRuntime.runtimeLastActiveAtByKey.clear();
    hostRuntime.rendererOnlyRuntimeKeys.clear();
    hostRuntime.automationRuntimeKeys.clear();
    hostRuntime.automationRuntimeProtectedUntilByKey.clear();
    hostRuntime.listeners.clear();
    hostRuntime.copyLinkListeners.clear();
    hostRuntime.states.clear();
    hostRuntime.previewThreadIds.clear();
    hostRuntime.threadVersionById.clear();
    hostRuntime.snapshotCacheByThreadId.clear();
    hostRuntime.lastEmittedVersionByThreadId.clear();
    hostRuntime.humanControlEpochByThreadId.clear();
    hostRuntime.humanControlListenersByThreadId.clear();
    hostRuntime.expectedAutomationInputsByRuntimeKey.clear();
    hostRuntime.automationGestureDepthByRuntimeKey.clear();
    hostRuntime.automationWindowOpenListenersByRuntimeKey.clear();
    hostRuntime.automationDownloadListenersByRuntimeKey.clear();
    hostRuntime.automationSideEffectProvenanceByRuntimeKey.clear();
    hostRuntime.runtimePageZoomFactors.clear();
    hostRuntime.window = null;
    hostRuntime.activeThreadId = null;
    hostRuntime.activeBounds = null;
    hostRuntime.activeBoundsThreadId = null;
    hostRuntime.activePageZoomFactor = 1;
    hostRuntime.activePageZoomThreadId = null;
    hostRuntime.attachedBoundsSignature = null;
    hostRuntime.runtimeSyncFlushScheduled = false;
  }

  function getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    hostRuntime.perfCounters.warmInactiveRuntimeCount = hostRuntime.countWarmInactiveRuntimes();
    return {
      counters: { ...hostRuntime.perfCounters },
      trackedProcessIds: hostRuntime.getTrackedProcessIds(),
    };
  }

  function getAutomationHumanControlEpoch(threadId: ThreadId): number {
    return hostRuntime.humanControlEpochByThreadId.get(threadId) ?? 0;
  }

  function isHumanBrowserOperationActive(): boolean {
    return hostRuntime.humanBrowserOperations > 0;
  }

  function beginHumanBrowserOperation(): () => void {
    hostRuntime.humanBrowserOperations += 1;
    for (const threadId of hostRuntime.states.keys()) hostRuntime.markHumanControl(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      hostRuntime.humanBrowserOperations -= 1;
    };
  }

  function subscribeAutomationHumanControl(
    threadId: ThreadId,
    listener: BrowserHumanControlListener,
  ): () => void {
    let listeners = hostRuntime.humanControlListenersByThreadId.get(threadId);
    if (!listeners) {
      listeners = new Set();
      hostRuntime.humanControlListenersByThreadId.set(threadId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) hostRuntime.humanControlListenersByThreadId.delete(threadId);
    };
  }

  function prepareAutomationTab(input: BrowserAutomationPrepareTabInput): ThreadBrowserState {
    const hadExistingTab = (hostRuntime.states.get(input.threadId)?.tabs.length ?? 0) > 0;
    const state = hostRuntime.ensureWorkspace(input.threadId, input.url);
    let tab = input.reuse || !hadExistingTab ? hostRuntime.getActiveTab(state) : null;
    if (!tab) {
      tab = createBrowserTab(normalizeUrlInput(input.url));
      state.tabs = [...state.tabs, tab];
    }

    hostRuntime.claimAutomationTab(input.threadId, tab);

    if (input.url !== undefined) {
      const nextUrl = normalizeUrlInput(input.url);
      tab.url = nextUrl;
      tab.title = defaultTitleForUrl(nextUrl);
      tab.lastCommittedUrl = null;
      tab.lastError = null;
    }
    state.open = true;
    state.activeTabId = tab.id;
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);
    hostRuntime.emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function selectAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }

    let didChange = false;
    didChange = hostRuntime.claimAutomationTab(input.threadId, tab) || didChange;
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      didChange = true;
    }
    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      hostRuntime.markThreadStateChanged(input.threadId);
      hostRuntime.emitState(input.threadId);
    }
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function prepareAutomationNavigation(
    input: BrowserAutomationPrepareNavigationInput,
  ): ThreadBrowserState {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    hostRuntime.claimAutomationTab(input.threadId, tab);
    const nextUrl = normalizeUrlInput(input.url);
    tab.url = nextUrl;
    tab.title = defaultTitleForUrl(nextUrl);
    tab.lastCommittedUrl = null;
    tab.lastError = null;
    state.activeTabId = tab.id;
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);
    hostRuntime.emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function getVisibleAutomationRuntime(input: BrowserTabInput): BrowserAutomationVisibleRuntime {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("The requested browser tab is not the visible tab for this thread.");
    }

    const runtime = hostRuntime.runtimes.get(buildRuntimeKey(input.threadId, tab.id));
    if (!runtime || runtime.webContents.isDestroyed()) {
      throw new Error("The visible browser page is not ready yet.");
    }
    if (runtime.ownsWebContents) {
      if (
        !runtime.view ||
        !hostRuntime.window ||
        hostRuntime.activeThreadId !== input.threadId ||
        hostRuntime.attachedRuntimeKey !== runtime.key ||
        hostRuntime.getVisibleBoundsForThread(input.threadId) === null
      ) {
        throw new Error("The requested native browser page is not currently visible.");
      }
      return {
        threadId: input.threadId,
        tabId: tab.id,
        webContents: runtime.webContents,
        expectAgentInput: (signal) =>
          hostRuntime.expectAutomationInput(input.threadId, tab.id, signal),
      };
    }

    if (
      hostRuntime.window &&
      (hostRuntime.activeThreadId !== input.threadId ||
        hostRuntime.attachedRuntimeKey !== runtime.key ||
        hostRuntime.getVisibleBoundsForThread(input.threadId) === null ||
        runtime.webContents.hostWebContents?.id !== hostRuntime.window.webContents.id)
    ) {
      throw new Error("The requested browser webview is not currently visible.");
    }
    return {
      threadId: input.threadId,
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) =>
        hostRuntime.expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  async function getCookieImportRuntime(
    input: BrowserTabInput,
  ): Promise<BrowserAutomationVisibleRuntime> {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab || state.activeTabId !== tab.id) {
      throw new Error("The cookie import tab is no longer selected.");
    }
    hostRuntime.clearSuspendTimer(input.threadId);
    const runtime = hostRuntime.ensureLiveRuntime(input.threadId, tab.id);
    if (!runtime.webContents.getURL())
      await hostRuntime.loadTab(input.threadId, tab.id, { runtime });
    return {
      threadId: input.threadId,
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) =>
        hostRuntime.expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  async function getAutomationRuntime(
    input: BrowserTabInput,
    options: { readonly restore?: boolean } = {},
  ): Promise<BrowserAutomationVisibleRuntime> {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("The requested browser tab is not the active tab for this thread.");
    }

    const didChange = hostRuntime.claimAutomationTab(input.threadId, tab);
    const runtime = hostRuntime.ensureLiveRuntime(input.threadId, tab.id);
    hostRuntime.noteAutomationRuntimeUse(runtime.key);
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = hostRuntime.sessionPolicy.resolveDisplayUrl(runtime.webContents.getURL());
    if ((options.restore ?? true) && (currentUrl.length === 0 || currentUrl !== expectedUrl)) {
      await hostRuntime.loadTab(input.threadId, tab.id, { force: true, runtime });
    } else if (!(options.restore ?? true) && currentUrl.length === 0) {
      await runtime.webContents.loadURL(ABOUT_BLANK_URL);
      tab.url = expectedUrl;
      tab.title = defaultTitleForUrl(expectedUrl);
      tab.lastCommittedUrl = null;
      tab.lastError = null;
    } else {
      hostRuntime.queueRuntimeStateSync(input.threadId, tab.id);
    }
    if (didChange) {
      hostRuntime.markThreadStateChanged(input.threadId);
      hostRuntime.emitState(input.threadId);
    }
    return {
      threadId: input.threadId,
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) =>
        hostRuntime.expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  function closeAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }

    hostRuntime.closePopupWindowsForTab(input.threadId, input.tabId);
    const runtime = hostRuntime.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
    const preservesRendererGuest = Boolean(
      runtime &&
      !runtime.ownsWebContents &&
      state.tabs.some((candidate) => candidate.id !== input.tabId),
    );
    const defersFinalRendererRemoval = Boolean(
      runtime && !runtime.ownsWebContents && !preservesRendererGuest,
    );
    hostRuntime.destroyRuntime(input.threadId, input.tabId, {
      preserveRendererDebugger: preservesRendererGuest,
    });
    hostRuntime.annotations.clearProjection(input.threadId, input.tabId);
    hostRuntime.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    hostRuntime.automationRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    state.tabs = state.tabs.filter((candidate) => candidate.id !== input.tabId);
    if (state.activeTabId === input.tabId) {
      state.activeTabId = state.tabs.at(-1)?.id ?? null;
    }
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(input.threadId);
    if (defersFinalRendererRemoval) {
      // Removing a live <webview> from an IPC state callback while the close request is still unwinding
      // can deadlock Electron. Publish on the next frame after the debugger has detached and the tool
      // response can drain.
      hostRuntime.scheduleDeferredStatePublication(
        buildRuntimeKey(input.threadId, input.tabId),
        input.threadId,
        false,
        runtime?.webContents,
      );
    } else {
      const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
      if (hostRuntime.activeThreadId === input.threadId && state.activeTabId && bounds) {
        hostRuntime.attachActiveTab(input.threadId, bounds);
      }
      hostRuntime.emitState(input.threadId);
    }
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  return {
    dispose,
    getPerformanceSnapshot,
    getAutomationHumanControlEpoch,
    isHumanBrowserOperationActive,
    beginHumanBrowserOperation,
    subscribeAutomationHumanControl,
    prepareAutomationTab,
    selectAutomationTab,
    prepareAutomationNavigation,
    getVisibleAutomationRuntime,
    getCookieImportRuntime,
    getAutomationRuntime,
    closeAutomationTab,
  };
}
