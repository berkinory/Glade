import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserTabInput, ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@glade/shared/browser/browserSession";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS,
  BrowserAutomationDownloadEvent,
  BrowserAutomationDownloadLease,
  BrowserAutomationDownloadListener,
  BrowserAutomationExpectedInput,
  BrowserAutomationSideEffectProvenance,
  browserAutomationInputMatches,
  BrowserAutomationWindowOpenEvent,
  BrowserAutomationWindowOpenListener,
  BrowserHumanControlListener,
  PendingBrowserAutomationInput,
  BrowserAutomationPrepareNavigationInput,
  BrowserAutomationPrepareTabInput,
  BrowserAutomationVisibleRuntime,
  buildRuntimeKey,
  createBrowserTab,
  defaultTitleForUrl,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserAutomationTabs(
  hostRuntime: Pick<
    BrowserRuntime,
    | "services"
    | "commitPendingAutomationWindowOpen"
    | "budget"
    | "live"
    | "tabs"
    | "view"
    | "ensureWorkspace"
    | "getActiveTab"
    | "claimAutomationTab"
    | "markThreadStateChanged"
    | "emitState"
    | "snapshotThreadState"
    | "getTab"
    | "getVisibleBoundsForThread"
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
  const automationWindowOpenListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationWindowOpenListener>
  >();
  const automationDownloadListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationDownloadLease>
  >();
  const automationSideEffectProvenanceByRuntimeKey = new Map<
    string,
    BrowserAutomationSideEffectProvenance
  >();
  const automationGestureDepthByRuntimeKey = new Map<string, number>();
  const humanControlEpochByThreadId = new Map<ThreadId, number>();
  const humanControlListenersByThreadId = new Map<ThreadId, Set<BrowserHumanControlListener>>();
  const expectedAutomationInputsByRuntimeKey = new Map<
    string,
    readonly PendingBrowserAutomationInput[]
  >();
  let humanBrowserOperations = 0;

  function getAutomationHumanControlEpoch(threadId: ThreadId): number {
    return humanControlEpochByThreadId.get(threadId) ?? 0;
  }

  function isHumanBrowserOperationActive(): boolean {
    return humanBrowserOperations > 0;
  }

  function beginHumanBrowserOperation(): () => void {
    humanBrowserOperations += 1;
    for (const threadId of hostRuntime.tabs.states.keys()) markHumanControl(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      humanBrowserOperations -= 1;
    };
  }

  function subscribeAutomationHumanControl(
    threadId: ThreadId,
    listener: BrowserHumanControlListener,
  ): () => void {
    let listeners = humanControlListenersByThreadId.get(threadId);
    if (!listeners) {
      listeners = new Set();
      humanControlListenersByThreadId.set(threadId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) humanControlListenersByThreadId.delete(threadId);
    };
  }

  function trackAutomationWindowOpen(
    input: BrowserTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ): () => void {
    const key = buildRuntimeKey(input.threadId, input.tabId);
    const listeners = automationWindowOpenListenersByRuntimeKey.get(key) ?? new Set();
    listeners.add(listener);
    automationWindowOpenListenersByRuntimeKey.set(key, listeners);
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      if (listeners.size === 0) automationWindowOpenListenersByRuntimeKey.delete(key);
      endAutomationGesture(key);
      if (listeners.size === 0) hostRuntime.commitPendingAutomationWindowOpen(key);
    };
  }

  function trackAutomationDownload(
    input: BrowserTabInput,
    listener: BrowserAutomationDownloadListener,
  ): () => void {
    const key = buildRuntimeKey(input.threadId, input.tabId);
    const listeners = automationDownloadListenersByRuntimeKey.get(key) ?? new Set();
    const humanControlEpoch = getAutomationHumanControlEpoch(input.threadId);
    const lease: BrowserAutomationDownloadLease = {
      listener,
      humanControlEpoch,
    };
    listeners.add(lease);
    automationDownloadListenersByRuntimeKey.set(key, listeners);

    automationSideEffectProvenanceByRuntimeKey.set(key, {
      threadId: input.threadId,
      humanControlEpoch,
    });
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(lease);
      if (listeners.size === 0) automationDownloadListenersByRuntimeKey.delete(key);
      endAutomationGesture(key);
    };
  }

  function beginAutomationGesture(key: string): void {
    automationGestureDepthByRuntimeKey.set(
      key,
      (automationGestureDepthByRuntimeKey.get(key) ?? 0) + 1,
    );
  }

  function endAutomationGesture(key: string): void {
    const nextDepth = Math.max(0, (automationGestureDepthByRuntimeKey.get(key) ?? 1) - 1);
    if (nextDepth === 0) {
      automationGestureDepthByRuntimeKey.delete(key);
      return;
    }
    automationGestureDepthByRuntimeKey.set(key, nextDepth);
  }

  function markHumanControl(threadId: ThreadId): void {
    hostRuntime.services.options.onHumanControl?.(threadId);
    const state = hostRuntime.tabs.states.get(threadId);
    const activeTab = state ? hostRuntime.getActiveTab(state) : null;
    if (activeTab) {
      hostRuntime.budget.runtimeLastActiveAtByKey.set(
        buildRuntimeKey(threadId, activeTab.id),
        Date.now(),
      );
    }
    humanControlEpochByThreadId.set(threadId, (humanControlEpochByThreadId.get(threadId) ?? 0) + 1);
    for (const [key, provenance] of automationSideEffectProvenanceByRuntimeKey) {
      if (provenance.threadId === threadId) {
        automationSideEffectProvenanceByRuntimeKey.delete(key);
      }
    }
    for (const listener of [...(humanControlListenersByThreadId.get(threadId) ?? [])]) {
      try {
        listener();
      } catch {
        // Input delivery must never be disrupted by an automation observer.
      }
    }
  }

  function expectAutomationInput(
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): () => void {
    const key = buildRuntimeKey(threadId, tabId);
    const now = Date.now();

    const zoom = hostRuntime.live.runtimes.get(key)?.webContents.getZoomFactor() ?? 1;
    const pending: PendingBrowserAutomationInput = {
      signal:
        signal.kind === "mouse" ? { ...signal, x: signal.x * zoom, y: signal.y * zoom } : signal,
      expiresAt: now + 1_000,
    };
    const current = (expectedAutomationInputsByRuntimeKey.get(key) ?? [])
      .filter((entry) => entry.expiresAt > now)
      .slice(-63);
    expectedAutomationInputsByRuntimeKey.set(key, [...current, pending]);
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const releaseTime = Date.now();
      const remaining = (expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
        (entry) => entry.expiresAt > releaseTime,
      );
      if (remaining.includes(pending)) {
        // Gesture/window-open correlation still ends immediately below, so unrelated agent attribution
        // cannot leak.
        pending.expiresAt = Math.min(
          pending.expiresAt,
          releaseTime + BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS,
        );
      }
      if (remaining.length === 0) expectedAutomationInputsByRuntimeKey.delete(key);
      else expectedAutomationInputsByRuntimeKey.set(key, remaining);
      endAutomationGesture(key);
    };
  }

  function isAutomationGestureActive(threadId: ThreadId, tabId: string): boolean {
    return (automationGestureDepthByRuntimeKey.get(buildRuntimeKey(threadId, tabId)) ?? 0) > 0;
  }

  function emitAutomationWindowOpen(event: BrowserAutomationWindowOpenEvent): void {
    const key = buildRuntimeKey(event.threadId, event.sourceTabId);
    for (const listener of [...(automationWindowOpenListenersByRuntimeKey.get(key) ?? [])]) {
      try {
        listener(event);
      } catch {
        // Window creation must not be disrupted by an automation observer.
      }
    }
  }

  function emitAutomationDownload(event: BrowserAutomationDownloadEvent): void {
    const key = buildRuntimeKey(event.threadId, event.sourceTabId);
    const humanControlEpoch = getAutomationHumanControlEpoch(event.threadId);
    for (const lease of [...(automationDownloadListenersByRuntimeKey.get(key) ?? [])]) {
      if (lease.humanControlEpoch !== humanControlEpoch) continue;
      try {
        lease.listener(event);
      } catch {
        // The download was already prevented. Observer failures must never destabilize the shared browser
        // session or re-enable the side effect.
      }
    }
  }

  function consumeExpectedAutomationInput(
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): boolean {
    const key = buildRuntimeKey(threadId, tabId);
    const now = Date.now();
    const pending = (expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
      (entry) => entry.expiresAt > now,
    );
    const matchedIndex = pending.findIndex((entry) =>
      browserAutomationInputMatches(entry.signal, signal),
    );
    if (matchedIndex < 0) {
      if (pending.length === 0) expectedAutomationInputsByRuntimeKey.delete(key);
      else expectedAutomationInputsByRuntimeKey.set(key, pending);
      return false;
    }
    pending.splice(matchedIndex, 1);
    if (pending.length === 0) expectedAutomationInputsByRuntimeKey.delete(key);
    else expectedAutomationInputsByRuntimeKey.set(key, pending);
    return true;
  }

  function clearAutomationState(): void {
    humanControlEpochByThreadId.clear();
    humanControlListenersByThreadId.clear();
    expectedAutomationInputsByRuntimeKey.clear();
    automationGestureDepthByRuntimeKey.clear();
    automationWindowOpenListenersByRuntimeKey.clear();
    automationDownloadListenersByRuntimeKey.clear();
    automationSideEffectProvenanceByRuntimeKey.clear();
    humanBrowserOperations = 0;
  }

  function clearAutomationRuntimeTracking(key: string, preserveDownloadTracking: boolean): void {
    expectedAutomationInputsByRuntimeKey.delete(key);
    automationWindowOpenListenersByRuntimeKey.delete(key);
    if (preserveDownloadTracking) return;
    automationGestureDepthByRuntimeKey.delete(key);
    automationDownloadListenersByRuntimeKey.delete(key);
    automationSideEffectProvenanceByRuntimeKey.delete(key);
  }

  function hasAutomationDownloadTracking(key: string): boolean {
    return (
      automationDownloadListenersByRuntimeKey.has(key) ||
      automationSideEffectProvenanceByRuntimeKey.has(key)
    );
  }

  function getAutomationSideEffectProvenance(
    key: string,
  ): BrowserAutomationSideEffectProvenance | undefined {
    return automationSideEffectProvenanceByRuntimeKey.get(key);
  }

  function inheritAutomationSideEffectProvenance(
    sourceKey: string,
    childKey: string,
    epoch: number,
  ): void {
    const provenance = automationSideEffectProvenanceByRuntimeKey.get(sourceKey);
    if (provenance?.humanControlEpoch === epoch) {
      automationSideEffectProvenanceByRuntimeKey.set(childKey, { ...provenance });
    }
  }

  function prepareAutomationTab(input: BrowserAutomationPrepareTabInput): ThreadBrowserState {
    const hadExistingTab = (hostRuntime.tabs.states.get(input.threadId)?.tabs.length ?? 0) > 0;
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
    const state = hostRuntime.tabs.states.get(input.threadId);
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
    const state = hostRuntime.tabs.states.get(input.threadId);
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
    const state = hostRuntime.tabs.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("The requested browser tab is not the visible tab for this thread.");
    }

    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, tab.id));
    if (!runtime || runtime.webContents.isDestroyed()) {
      throw new Error("The visible browser page is not ready yet.");
    }
    if (runtime.ownsWebContents) {
      if (
        !runtime.view ||
        !hostRuntime.view.window ||
        hostRuntime.view.activeThreadId !== input.threadId ||
        hostRuntime.view.attachedRuntimeKey !== runtime.key ||
        hostRuntime.getVisibleBoundsForThread(input.threadId) === null
      ) {
        throw new Error("The requested native browser page is not currently visible.");
      }
      return {
        threadId: input.threadId,
        tabId: tab.id,
        webContents: runtime.webContents,
        expectAgentInput: (signal) => expectAutomationInput(input.threadId, tab.id, signal),
      };
    }

    if (
      hostRuntime.view.window &&
      (hostRuntime.view.activeThreadId !== input.threadId ||
        hostRuntime.view.attachedRuntimeKey !== runtime.key ||
        hostRuntime.getVisibleBoundsForThread(input.threadId) === null ||
        runtime.webContents.hostWebContents?.id !== hostRuntime.view.window.webContents.id)
    ) {
      throw new Error("The requested browser webview is not currently visible.");
    }
    return {
      threadId: input.threadId,
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) => expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  async function getCookieImportRuntime(
    input: BrowserTabInput,
  ): Promise<BrowserAutomationVisibleRuntime> {
    const state = hostRuntime.tabs.states.get(input.threadId);
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
      expectAgentInput: (signal) => expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  async function getAutomationRuntime(
    input: BrowserTabInput,
    options: { readonly restore?: boolean } = {},
  ): Promise<BrowserAutomationVisibleRuntime> {
    const state = hostRuntime.tabs.states.get(input.threadId);
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
    const currentUrl = hostRuntime.services.sessionPolicy.resolveDisplayUrl(
      runtime.webContents.getURL(),
    );
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
      expectAgentInput: (signal) => expectAutomationInput(input.threadId, tab.id, signal),
    };
  }

  function closeAutomationTab(input: BrowserTabInput): ThreadBrowserState {
    const state = hostRuntime.tabs.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }

    hostRuntime.closePopupWindowsForTab(input.threadId, input.tabId);
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
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
    hostRuntime.services.annotations.clearProjection(input.threadId, input.tabId);
    hostRuntime.live.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    hostRuntime.live.automationRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
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
      if (hostRuntime.view.activeThreadId === input.threadId && state.activeTabId && bounds) {
        hostRuntime.attachActiveTab(input.threadId, bounds);
      }
      hostRuntime.emitState(input.threadId);
    }
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  return {
    clearAutomationState,
    clearAutomationRuntimeTracking,
    hasAutomationDownloadTracking,
    getAutomationSideEffectProvenance,
    inheritAutomationSideEffectProvenance,
    getAutomationHumanControlEpoch,
    isHumanBrowserOperationActive,
    beginHumanBrowserOperation,
    subscribeAutomationHumanControl,
    trackAutomationWindowOpen,
    trackAutomationDownload,
    markHumanControl,
    expectAutomationInput,
    isAutomationGestureActive,
    emitAutomationWindowOpen,
    emitAutomationDownload,
    consumeExpectedAutomationInput,
    prepareAutomationTab,
    selectAutomationTab,
    prepareAutomationNavigation,
    getVisibleAutomationRuntime,
    getCookieImportRuntime,
    getAutomationRuntime,
    closeAutomationTab,
  };
}
