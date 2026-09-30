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
    | "services"
    | "budget"
    | "live"
    | "tabs"
    | "view"
    | "getActiveTab"
    | "markHumanControl"
    | "ensureWorkspace"
    | "navigate"
    | "markThreadStateChanged"
    | "emitState"
    | "snapshotThreadState"
    | "clearSuspendTimer"
    | "detachAttachedRuntime"
    | "closePopupWindowsForThread"
    | "destroyThreadRuntimes"
    | "getOrCreateState"
    | "scheduleThreadSuspend"
    | "enforceBackgroundAutomationRuntimeBudget"
    | "destroyRuntime"
    | "getTab"
    | "updatePopupWindowsForThread"
    | "attachRuntime"
    | "attachActiveTab"
    | "setRuntimeViewHidden"
    | "suspendInactiveTabs"
    | "ensureLiveRuntime"
    | "loadTab"
  >,
) {
  function open(input: BrowserOpenInput): ThreadBrowserState {
    const previousState = hostRuntime.tabs.states.get(input.threadId);
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
      hostRuntime.view.activeBounds &&
      hostRuntime.view.activeBoundsThreadId === input.threadId &&
      (hostRuntime.view.activeThreadId === null ||
        hostRuntime.view.activeThreadId === input.threadId)
    ) {
      const visibleTab = hostRuntime.getActiveTab(state);
      if (!isBlankBrowserTabUrl(visibleTab)) {
        activateThread(input.threadId, hostRuntime.view.activeBounds);
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

    if (hostRuntime.view.activeThreadId === input.threadId) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.view.activeThreadId = null;
    }
    clearActiveBoundsForThread(input.threadId);
    hostRuntime.closePopupWindowsForThread(input.threadId);

    const existingState = hostRuntime.tabs.states.get(input.threadId);
    hostRuntime.destroyThreadRuntimes(input.threadId);
    for (const tab of existingState?.tabs ?? []) {
      hostRuntime.services.annotations.clearProjection(input.threadId, tab.id);
      hostRuntime.live.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, tab.id));
      hostRuntime.live.automationRuntimeKeys.delete(buildRuntimeKey(input.threadId, tab.id));
    }

    const state = hostRuntime.getOrCreateState(input.threadId);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    hostRuntime.markThreadStateChanged(input.threadId);
    hostRuntime.tabs.lastEmittedVersionByThreadId.delete(input.threadId);
    hostRuntime.emitState(input.threadId);
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function hide(input: BrowserThreadInput): void {
    const state = hostRuntime.tabs.states.get(input.threadId);
    const activeTab = state ? hostRuntime.getActiveTab(state) : null;
    const keepsAgentRuntimeAlive = Boolean(
      activeTab &&
      hostRuntime.live.automationRuntimeKeys.has(buildRuntimeKey(input.threadId, activeTab.id)),
    );
    if (!keepsAgentRuntimeAlive) {
      hostRuntime.markHumanControl(input.threadId);
    }
    // A hidden browser must never leave the miniature presentation zoom on a runtime that automation or
    // a later screenshot can reacquire.
    resetRuntimePageZoomForThread(input.threadId);
    if (hostRuntime.view.activeThreadId === input.threadId) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.view.activeThreadId = null;
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
    hostRuntime.budget.perfCounters.setPanelBoundsCalls += 1;
    const previewChanged =
      hostRuntime.tabs.previewThreadIds.has(input.threadId) !== (input.preview === true);
    if (input.preview) hostRuntime.tabs.previewThreadIds.add(input.threadId);
    else hostRuntime.tabs.previewThreadIds.delete(input.threadId);
    if (previewChanged) hostRuntime.view.attachedBoundsSignature = null;
    const state = hostRuntime.getOrCreateState(input.threadId);
    const nextBounds = normalizeBounds(input.bounds);
    const nextPageZoomFactor = nextBounds
      ? normalizeBrowserPageZoomFactor(input.pageZoomFactor)
      : 1;
    const nextBoundsSignature = browserPresentationSignature(nextBounds, nextPageZoomFactor);
    const activeTabId = hostRuntime.getActiveTab(state)?.id ?? null;
    const activeRuntimeKey = activeTabId ? buildRuntimeKey(input.threadId, activeTabId) : null;
    const activeRuntime = activeRuntimeKey ? hostRuntime.live.runtimes.get(activeRuntimeKey) : null;
    const surface =
      activeTabId && isNativeAutomationTab(input.threadId, activeTabId) ? "native" : input.surface;
    if (surface === "native" && activeRuntimeKey) {
      hostRuntime.live.rendererOnlyRuntimeKeys.delete(activeRuntimeKey);
    }
    const requiresRenderer = activeRuntimeKey
      ? hostRuntime.live.rendererOnlyRuntimeKeys.has(activeRuntimeKey)
      : false;

    if (
      state.open &&
      nextBounds === null &&
      (surface === "renderer" || requiresRenderer) &&
      activeRuntime &&
      !activeRuntime.ownsWebContents
    ) {
      hostRuntime.budget.perfCounters.setPanelBoundsNoopSkips += 1;
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
      if (hostRuntime.view.activeThreadId === input.threadId) {
        hostRuntime.detachAttachedRuntime();
        hostRuntime.view.activeThreadId = null;
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
      hostRuntime.view.attachedRuntimeKey = null;
      hostRuntime.view.attachedBoundsSignature = null;
    }

    if ((surface === "renderer" || requiresRenderer) && activeTabId && !activeRuntime) {
      if (activeRuntimeKey) hostRuntime.live.rendererOnlyRuntimeKeys.add(activeRuntimeKey);
      activateThreadForPendingRenderer(input.threadId, nextBounds, nextPageZoomFactor);
      return;
    }

    if (
      hostRuntime.view.activeThreadId === input.threadId &&
      hostRuntime.view.attachedRuntimeKey === activeRuntimeKey &&
      hostRuntime.view.attachedBoundsSignature === nextBoundsSignature
    ) {
      hostRuntime.budget.perfCounters.setPanelBoundsNoopSkips += 1;
      return;
    }

    hostRuntime.updatePopupWindowsForThread(input.threadId);

    if (hostRuntime.view.activeThreadId === input.threadId) {
      if (activeRuntimeKey && hostRuntime.view.attachedRuntimeKey === activeRuntimeKey) {
        const runtime = hostRuntime.live.runtimes.get(activeRuntimeKey);
        if (runtime) {
          hostRuntime.budget.perfCounters.setPanelBoundsViewportUpdates += 1;
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
    const previousThreadId = hostRuntime.view.activeThreadId;
    if (hostRuntime.view.activeThreadId && hostRuntime.view.activeThreadId !== threadId) {
      resetRuntimePageZoomForThread(hostRuntime.view.activeThreadId);
      hostRuntime.scheduleThreadSuspend(hostRuntime.view.activeThreadId);
    }

    hostRuntime.view.activeThreadId = threadId;
    hostRuntime.view.activeBounds = bounds;
    hostRuntime.view.activeBoundsThreadId = threadId;
    setActivePageZoomFactor(threadId, pageZoomFactor);
    if (previousThreadId && previousThreadId !== threadId) {
      hostRuntime.updatePopupWindowsForThread(previousThreadId);
    }
    resumeThread(threadId);
    hostRuntime.attachActiveTab(threadId, bounds, { pageZoomFactor });
    hostRuntime.updatePopupWindowsForThread(threadId);
  }

  function isNativeAutomationTab(threadId: ThreadId, tabId: string): boolean {
    const state = hostRuntime.tabs.states.get(threadId);
    return (
      hostRuntime.live.automationRuntimeKeys.has(buildRuntimeKey(threadId, tabId)) &&
      state !== undefined &&
      hostRuntime.getTab(state, tabId)?.runtimeSurface === "native"
    );
  }

  function promoteTabToRendererSurface(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const runtime = hostRuntime.live.runtimes.get(key);
    if (runtime?.ownsWebContents && runtime.view) {
      hostRuntime.setRuntimeViewHidden(runtime, true);
    }
    if (hostRuntime.view.attachedRuntimeKey === key) {
      hostRuntime.view.attachedRuntimeKey = null;
      hostRuntime.view.attachedBoundsSignature = null;
    }
    hostRuntime.live.rendererOnlyRuntimeKeys.add(key);
    const state = hostRuntime.tabs.states.get(threadId);
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
    const previousThreadId = hostRuntime.view.activeThreadId;
    if (previousThreadId && previousThreadId !== threadId) {
      resetRuntimePageZoomForThread(previousThreadId);
      hostRuntime.scheduleThreadSuspend(previousThreadId);
      hostRuntime.updatePopupWindowsForThread(previousThreadId);
    }
    hostRuntime.view.activeThreadId = threadId;
    hostRuntime.view.activeBounds = bounds;
    hostRuntime.view.activeBoundsThreadId = threadId;
    setActivePageZoomFactor(threadId, pageZoomFactor);
    hostRuntime.clearSuspendTimer(threadId);
    hostRuntime.updatePopupWindowsForThread(threadId);
  }

  function setActiveBounds(threadId: ThreadId, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      clearActiveBoundsForThread(threadId);
      return;
    }
    hostRuntime.view.activeBounds = bounds;
    hostRuntime.view.activeBoundsThreadId = threadId;
  }

  function clearActiveBoundsForThread(threadId: ThreadId): void {
    if (hostRuntime.view.activeBoundsThreadId !== threadId) {
      return;
    }
    hostRuntime.view.activeBounds = null;
    hostRuntime.view.activeBoundsThreadId = null;
    clearActivePageZoomForThread(threadId);
  }

  function getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null {
    return hostRuntime.view.activeBoundsThreadId === threadId
      ? hostRuntime.view.activeBounds
      : null;
  }

  function setActivePageZoomFactor(threadId: ThreadId, pageZoomFactor: number): void {
    hostRuntime.view.activePageZoomThreadId = threadId;
    hostRuntime.view.activePageZoomFactor = normalizeBrowserPageZoomFactor(pageZoomFactor);
  }

  function clearActivePageZoomForThread(threadId: ThreadId): void {
    if (hostRuntime.view.activePageZoomThreadId !== threadId) {
      return;
    }
    hostRuntime.view.activePageZoomThreadId = null;
    hostRuntime.view.activePageZoomFactor = 1;
  }

  function getVisiblePageZoomFactor(threadId: ThreadId): number {
    return hostRuntime.view.activePageZoomThreadId === threadId
      ? hostRuntime.view.activePageZoomFactor
      : 1;
  }

  function setRuntimePageZoomFactor(runtime: LiveTabRuntime, pageZoomFactor: number): void {
    const nextPageZoomFactor = normalizeBrowserPageZoomFactor(pageZoomFactor);
    if (hostRuntime.live.runtimePageZoomFactors.get(runtime.key) === nextPageZoomFactor) {
      return;
    }

    try {
      runtime.webContents.setZoomFactor(nextPageZoomFactor);
    } catch {}
    hostRuntime.live.runtimePageZoomFactors.set(runtime.key, nextPageZoomFactor);
  }

  function clearRuntimeViewportOverride(runtime: LiveTabRuntime): void {
    if (runtime.webContents.isDestroyed() || !runtime.webContents.debugger.isAttached()) return;
    void runtime.webContents.debugger
      .sendCommand("Emulation.clearDeviceMetricsOverride")
      .catch(() => {});
  }

  function resetRuntimePageZoomForThread(threadId: ThreadId): void {
    for (const runtime of hostRuntime.live.runtimes.values()) {
      if (runtime.threadId === threadId) {
        setRuntimePageZoomFactor(runtime, 1);
      }
    }
    if (hostRuntime.view.activePageZoomThreadId === threadId) {
      hostRuntime.view.activePageZoomFactor = 1;
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
      if (hostRuntime.live.rendererOnlyRuntimeKeys.has(runtimeKey)) {
        const rendererRuntime = hostRuntime.live.runtimes.get(runtimeKey);
        if (!rendererRuntime || rendererRuntime.ownsWebContents) {
          if (rendererRuntime?.ownsWebContents) hostRuntime.destroyRuntime(threadId, tab.id);
          continue;
        }
      }
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
      const runtime = hostRuntime.ensureLiveRuntime(threadId, tab.id);
      if (wasSuspended && !hostRuntime.live.automationRuntimeKeys.has(runtimeKey)) {
        void hostRuntime.loadTab(threadId, tab.id, { force: true, runtime });
      } else {
        didChange =
          syncTabStateFromRuntime(state, tab, runtime.webContents, (url) =>
            hostRuntime.services.sessionPolicy.resolveDisplayUrl(url),
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
