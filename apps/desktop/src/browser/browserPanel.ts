import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  BrowserOpenInput,
  BrowserPanelBounds,
  BrowserSetPanelBoundsInput,
  BrowserThreadInput,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import {
  isBlankBrowserTabUrl,
  normalizeBrowserPageZoomFactor,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@glade/shared/browser/browserSession";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  browserPresentationSignature,
  buildRuntimeKey,
  LiveTabRuntime,
  normalizeBounds,
  SUSPENDED_TAB_STATUS,
  suspendTabState,
  syncTabStateFromRuntime,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserPanel(
  hostRuntime: Pick<
    BrowserRuntime,
    | "states"
    | "getActiveTab"
    | "markHumanControl"
    | "ensureWorkspace"
    | "navigate"
    | "activeBounds"
    | "activeBoundsThreadId"
    | "activeThreadId"
    | "markThreadStateChanged"
    | "emitState"
    | "snapshotThreadState"
    | "clearSuspendTimer"
    | "detachAttachedRuntime"
    | "closePopupWindowsForThread"
    | "destroyThreadRuntimes"
    | "annotations"
    | "rendererOnlyRuntimeKeys"
    | "automationRuntimeKeys"
    | "getOrCreateState"
    | "lastEmittedVersionByThreadId"
    | "scheduleThreadSuspend"
    | "enforceBackgroundAutomationRuntimeBudget"
    | "perfCounters"
    | "previewThreadIds"
    | "attachedBoundsSignature"
    | "runtimes"
    | "destroyRuntime"
    | "getTab"
    | "attachedRuntimeKey"
    | "updatePopupWindowsForThread"
    | "attachRuntime"
    | "attachActiveTab"
    | "setRuntimeViewHidden"
    | "activePageZoomThreadId"
    | "activePageZoomFactor"
    | "runtimePageZoomFactors"
    | "suspendInactiveTabs"
    | "ensureLiveRuntime"
    | "loadTab"
    | "sessionPolicy"
  >,
) {
  function open(input: BrowserOpenInput): ThreadBrowserState {
    const previousState = hostRuntime.states.get(input.threadId);
    const nextInitialUrl = input.initialUrl ? normalizeUrlInput(input.initialUrl) : null;
    const previousActiveTab = previousState ? hostRuntime.getActiveTab(previousState) : null;
    const willNavigateExistingTab =
      nextInitialUrl !== null &&
      previousActiveTab !== null &&
      previousActiveTab.url !== nextInitialUrl;

    if (previousState?.open !== true && !willNavigateExistingTab) {
      hostRuntime.markHumanControl(input.threadId);
    }
    const state = hostRuntime.ensureWorkspace(input.threadId, input.initialUrl);
    const didChange = !state.open;
    state.open = true;
    const activeTab = nextInitialUrl ? hostRuntime.getActiveTab(state) : null;
    if (nextInitialUrl && activeTab && activeTab.url !== nextInitialUrl) {
      return hostRuntime.navigate({
        threadId: input.threadId,
        tabId: activeTab.id,
        url: nextInitialUrl,
      });
    }

    const nextDidChange = syncThreadLastError(state) || didChange;

    if (
      hostRuntime.activeBounds &&
      hostRuntime.activeBoundsThreadId === input.threadId &&
      (hostRuntime.activeThreadId === null || hostRuntime.activeThreadId === input.threadId)
    ) {
      const visibleTab = hostRuntime.getActiveTab(state);
      if (!isBlankBrowserTabUrl(visibleTab)) {
        activateThread(input.threadId, hostRuntime.activeBounds);
      }
    }

    if (nextDidChange) {
      hostRuntime.markThreadStateChanged(input.threadId);
    }
    hostRuntime.emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function close(input: BrowserThreadInput): ThreadBrowserState {
    hostRuntime.markHumanControl(input.threadId);
    hostRuntime.clearSuspendTimer(input.threadId);
    resetRuntimePageZoomForThread(input.threadId);

    if (hostRuntime.activeThreadId === input.threadId) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.activeThreadId = null;
    }
    clearActiveBoundsForThread(input.threadId);
    hostRuntime.closePopupWindowsForThread(input.threadId);

    const existingState = hostRuntime.states.get(input.threadId);
    hostRuntime.destroyThreadRuntimes(input.threadId);
    for (const tab of existingState?.tabs ?? []) {
      hostRuntime.annotations.clearProjection(input.threadId, tab.id);
      hostRuntime.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, tab.id));
      hostRuntime.automationRuntimeKeys.delete(buildRuntimeKey(input.threadId, tab.id));
    }

    const state = hostRuntime.getOrCreateState(input.threadId);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    hostRuntime.markThreadStateChanged(input.threadId);
    hostRuntime.lastEmittedVersionByThreadId.delete(input.threadId);
    hostRuntime.emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function hide(input: BrowserThreadInput): void {
    const state = hostRuntime.states.get(input.threadId);
    const activeTab = state ? hostRuntime.getActiveTab(state) : null;
    const keepsAgentRuntimeAlive = Boolean(
      activeTab &&
      hostRuntime.automationRuntimeKeys.has(buildRuntimeKey(input.threadId, activeTab.id)),
    );
    if (!keepsAgentRuntimeAlive) {
      hostRuntime.markHumanControl(input.threadId);
    }
    // A hidden browser must never leave the miniature presentation zoom on a runtime that automation or
    // a later screenshot can reacquire.
    resetRuntimePageZoomForThread(input.threadId);
    if (hostRuntime.activeThreadId === input.threadId) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.activeThreadId = null;
    }

    if (!state?.open) {
      return;
    }

    hostRuntime.scheduleThreadSuspend(input.threadId);
    hostRuntime.enforceBackgroundAutomationRuntimeBudget();
  }

  function getState(input: BrowserThreadInput): ThreadBrowserState {
    return hostRuntime.snapshotThreadState(input.threadId);
  }

  function setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    hostRuntime.perfCounters.setPanelBoundsCalls += 1;
    const previewChanged =
      hostRuntime.previewThreadIds.has(input.threadId) !== (input.preview === true);
    if (input.preview) hostRuntime.previewThreadIds.add(input.threadId);
    else hostRuntime.previewThreadIds.delete(input.threadId);
    if (previewChanged) hostRuntime.attachedBoundsSignature = null;
    const state = hostRuntime.getOrCreateState(input.threadId);
    const nextBounds = normalizeBounds(input.bounds);
    const nextPageZoomFactor = nextBounds
      ? normalizeBrowserPageZoomFactor(input.pageZoomFactor)
      : 1;
    const nextBoundsSignature = browserPresentationSignature(nextBounds, nextPageZoomFactor);
    const activeTabId = hostRuntime.getActiveTab(state)?.id ?? null;
    const activeRuntimeKey = activeTabId ? buildRuntimeKey(input.threadId, activeTabId) : null;
    const activeRuntime = activeRuntimeKey ? hostRuntime.runtimes.get(activeRuntimeKey) : null;
    const surface =
      activeTabId && isNativeAutomationTab(input.threadId, activeTabId) ? "native" : input.surface;
    if (surface === "native" && activeRuntimeKey) {
      hostRuntime.rendererOnlyRuntimeKeys.delete(activeRuntimeKey);
    }
    const requiresRenderer = activeRuntimeKey
      ? hostRuntime.rendererOnlyRuntimeKeys.has(activeRuntimeKey)
      : false;

    if (
      state.open &&
      nextBounds === null &&
      (surface === "renderer" || requiresRenderer) &&
      activeRuntime &&
      !activeRuntime.ownsWebContents
    ) {
      hostRuntime.perfCounters.setPanelBoundsNoopSkips += 1;
      return;
    }
    const previousBounds = getVisibleBoundsForThread(input.threadId);
    if (
      state.open &&
      nextBounds &&
      activeRuntime &&
      (previousBounds?.width !== nextBounds.width ||
        previousBounds?.height !== nextBounds.height ||
        getVisiblePageZoomFactor(input.threadId) !== nextPageZoomFactor ||
        previewChanged)
    ) {
      clearRuntimeViewportOverride(activeRuntime);
    }
    setActivePageZoomFactor(input.threadId, nextPageZoomFactor);
    setActiveBounds(input.threadId, nextBounds);

    if (!state.open || nextBounds === null) {
      resetRuntimePageZoomForThread(input.threadId);
      if (hostRuntime.activeThreadId === input.threadId) {
        hostRuntime.detachAttachedRuntime();
        hostRuntime.activeThreadId = null;
        if (state.open && input.occluded === true) {
          hostRuntime.clearSuspendTimer(input.threadId);
        } else {
          hostRuntime.scheduleThreadSuspend(input.threadId);
        }
      }
      return;
    }

    if (
      surface === "renderer" &&
      activeTabId &&
      activeRuntimeKey &&
      activeRuntime?.ownsWebContents
    ) {
      promoteTabToRendererSurface(input.threadId, activeTabId);
      activateThreadForPendingRenderer(input.threadId, nextBounds, 1);
      return;
    }

    if (
      surface === "native" &&
      !requiresRenderer &&
      activeTabId &&
      activeRuntime &&
      !activeRuntime.ownsWebContents
    ) {
      hostRuntime.destroyRuntime(input.threadId, activeTabId);
      const activeTab = hostRuntime.getTab(state, activeTabId);
      if (activeTab) {
        activeTab.runtimeSurface = "native";
        suspendTabState(activeTab);
        hostRuntime.markThreadStateChanged(input.threadId);
      }
      hostRuntime.attachedRuntimeKey = null;
      hostRuntime.attachedBoundsSignature = null;
    }

    if ((surface === "renderer" || requiresRenderer) && activeTabId && !activeRuntime) {
      if (activeRuntimeKey) hostRuntime.rendererOnlyRuntimeKeys.add(activeRuntimeKey);
      activateThreadForPendingRenderer(input.threadId, nextBounds, nextPageZoomFactor);
      return;
    }

    if (
      hostRuntime.activeThreadId === input.threadId &&
      hostRuntime.attachedRuntimeKey === activeRuntimeKey &&
      hostRuntime.attachedBoundsSignature === nextBoundsSignature
    ) {
      hostRuntime.perfCounters.setPanelBoundsNoopSkips += 1;
      return;
    }

    hostRuntime.updatePopupWindowsForThread(input.threadId);

    if (hostRuntime.activeThreadId === input.threadId) {
      if (activeRuntimeKey && hostRuntime.attachedRuntimeKey === activeRuntimeKey) {
        const runtime = hostRuntime.runtimes.get(activeRuntimeKey);
        if (runtime) {
          hostRuntime.perfCounters.setPanelBoundsViewportUpdates += 1;
          hostRuntime.attachRuntime(runtime, nextBounds, nextPageZoomFactor);
          return;
        }
      }
      hostRuntime.attachActiveTab(input.threadId, nextBounds, {
        pageZoomFactor: nextPageZoomFactor,
      });
      return;
    }

    activateThread(input.threadId, nextBounds, nextPageZoomFactor);
  }

  function activateThread(
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    pageZoomFactor = getVisiblePageZoomFactor(threadId),
  ): void {
    const previousThreadId = hostRuntime.activeThreadId;
    if (hostRuntime.activeThreadId && hostRuntime.activeThreadId !== threadId) {
      resetRuntimePageZoomForThread(hostRuntime.activeThreadId);
      hostRuntime.scheduleThreadSuspend(hostRuntime.activeThreadId);
    }

    hostRuntime.activeThreadId = threadId;
    hostRuntime.activeBounds = bounds;
    hostRuntime.activeBoundsThreadId = threadId;
    setActivePageZoomFactor(threadId, pageZoomFactor);
    if (previousThreadId && previousThreadId !== threadId) {
      hostRuntime.updatePopupWindowsForThread(previousThreadId);
    }
    resumeThread(threadId);
    hostRuntime.attachActiveTab(threadId, bounds, { pageZoomFactor });
    hostRuntime.updatePopupWindowsForThread(threadId);
  }

  function isNativeAutomationTab(threadId: ThreadId, tabId: string): boolean {
    const state = hostRuntime.states.get(threadId);
    return (
      hostRuntime.automationRuntimeKeys.has(buildRuntimeKey(threadId, tabId)) &&
      state !== undefined &&
      hostRuntime.getTab(state, tabId)?.runtimeSurface === "native"
    );
  }

  function promoteTabToRendererSurface(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const runtime = hostRuntime.runtimes.get(key);
    if (runtime?.ownsWebContents && runtime.view) {
      hostRuntime.setRuntimeViewHidden(runtime, true);
    }
    if (hostRuntime.attachedRuntimeKey === key) {
      hostRuntime.attachedRuntimeKey = null;
      hostRuntime.attachedBoundsSignature = null;
    }
    hostRuntime.rendererOnlyRuntimeKeys.add(key);
    const state = hostRuntime.states.get(threadId);
    const tab = state ? hostRuntime.getTab(state, tabId) : null;
    if (tab && tab.runtimeSurface !== "renderer") {
      tab.runtimeSurface = "renderer";
      hostRuntime.markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }
  }

  function activateThreadForPendingRenderer(
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    pageZoomFactor = getVisiblePageZoomFactor(threadId),
  ): void {
    const previousThreadId = hostRuntime.activeThreadId;
    if (previousThreadId && previousThreadId !== threadId) {
      resetRuntimePageZoomForThread(previousThreadId);
      hostRuntime.scheduleThreadSuspend(previousThreadId);
      hostRuntime.updatePopupWindowsForThread(previousThreadId);
    }
    hostRuntime.activeThreadId = threadId;
    hostRuntime.activeBounds = bounds;
    hostRuntime.activeBoundsThreadId = threadId;
    setActivePageZoomFactor(threadId, pageZoomFactor);
    hostRuntime.clearSuspendTimer(threadId);
    hostRuntime.updatePopupWindowsForThread(threadId);
  }

  function setActiveBounds(threadId: ThreadId, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      clearActiveBoundsForThread(threadId);
      return;
    }
    hostRuntime.activeBounds = bounds;
    hostRuntime.activeBoundsThreadId = threadId;
  }

  function clearActiveBoundsForThread(threadId: ThreadId): void {
    if (hostRuntime.activeBoundsThreadId !== threadId) {
      return;
    }
    hostRuntime.activeBounds = null;
    hostRuntime.activeBoundsThreadId = null;
    clearActivePageZoomForThread(threadId);
  }

  function getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null {
    return hostRuntime.activeBoundsThreadId === threadId ? hostRuntime.activeBounds : null;
  }

  function setActivePageZoomFactor(threadId: ThreadId, pageZoomFactor: number): void {
    hostRuntime.activePageZoomThreadId = threadId;
    hostRuntime.activePageZoomFactor = normalizeBrowserPageZoomFactor(pageZoomFactor);
  }

  function clearActivePageZoomForThread(threadId: ThreadId): void {
    if (hostRuntime.activePageZoomThreadId !== threadId) {
      return;
    }
    hostRuntime.activePageZoomThreadId = null;
    hostRuntime.activePageZoomFactor = 1;
  }

  function getVisiblePageZoomFactor(threadId: ThreadId): number {
    return hostRuntime.activePageZoomThreadId === threadId ? hostRuntime.activePageZoomFactor : 1;
  }

  function setRuntimePageZoomFactor(runtime: LiveTabRuntime, pageZoomFactor: number): void {
    const nextPageZoomFactor = normalizeBrowserPageZoomFactor(pageZoomFactor);
    if (hostRuntime.runtimePageZoomFactors.get(runtime.key) === nextPageZoomFactor) {
      return;
    }

    try {
      runtime.webContents.setZoomFactor(nextPageZoomFactor);
    } catch {}
    hostRuntime.runtimePageZoomFactors.set(runtime.key, nextPageZoomFactor);
  }

  function clearRuntimeViewportOverride(runtime: LiveTabRuntime): void {
    if (runtime.webContents.isDestroyed() || !runtime.webContents.debugger.isAttached()) return;
    void runtime.webContents.debugger
      .sendCommand("Emulation.clearDeviceMetricsOverride")
      .catch(() => {});
  }

  function resetRuntimePageZoomForThread(threadId: ThreadId): void {
    for (const runtime of hostRuntime.runtimes.values()) {
      if (runtime.threadId === threadId) {
        setRuntimePageZoomFactor(runtime, 1);
      }
    }
    if (hostRuntime.activePageZoomThreadId === threadId) {
      hostRuntime.activePageZoomFactor = 1;
    }
  }

  function resumeThread(threadId: ThreadId): void {
    const state = hostRuntime.ensureWorkspace(threadId);
    if (!state.open) {
      return;
    }

    hostRuntime.clearSuspendTimer(threadId);
    const activeTab = hostRuntime.getActiveTab(state);
    let didChange = hostRuntime.suspendInactiveTabs(threadId, activeTab?.id ?? null);

    for (const tab of state.tabs) {
      if (tab.id !== activeTab?.id) {
        continue;
      }
      const runtimeKey = buildRuntimeKey(threadId, tab.id);
      if (hostRuntime.rendererOnlyRuntimeKeys.has(runtimeKey)) {
        const rendererRuntime = hostRuntime.runtimes.get(runtimeKey);
        if (!rendererRuntime || rendererRuntime.ownsWebContents) {
          if (rendererRuntime?.ownsWebContents) hostRuntime.destroyRuntime(threadId, tab.id);
          continue;
        }
      }
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
      const runtime = hostRuntime.ensureLiveRuntime(threadId, tab.id);
      if (wasSuspended && !hostRuntime.automationRuntimeKeys.has(runtimeKey)) {
        void hostRuntime.loadTab(threadId, tab.id, { force: true, runtime });
      } else {
        didChange =
          syncTabStateFromRuntime(state, tab, runtime.webContents, (url) =>
            hostRuntime.sessionPolicy.resolveDisplayUrl(url),
          ) || didChange;
      }
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      hostRuntime.markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }
    hostRuntime.enforceBackgroundAutomationRuntimeBudget();
  }

  return {
    open,
    close,
    hide,
    getState,
    setPanelBounds,
    isNativeAutomationTab,
    promoteTabToRendererSurface,
    activateThreadForPendingRenderer,
    getVisibleBoundsForThread,
    getVisiblePageZoomFactor,
    setRuntimePageZoomFactor,
    resumeThread,
  };
}
