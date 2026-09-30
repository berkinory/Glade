import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  classifyBrowserWindowOpen,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@glade/shared/browser/browserSession";
import type { WebContents } from "electron";
import { BrowserWindow } from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { type BrowserSessionDownloadEvent } from "./browserSessionPolicy";
import {
  BROWSER_AUTOMATION_WINDOW_OPEN_FALLBACK_MS,
  BROWSER_DEFERRED_PUBLICATION_DELAY_MS,
  buildRuntimeKey,
  createBrowserTab,
  EmbeddedPopupOptions,
  isAllowedBrowserRuntimeNavigation,
  LiveTabRuntime,
  OAuthPopupContext,
  OAuthPopupRuntime,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserPopupRuntime(
  hostRuntime: Pick<
    BrowserRuntime,
    | "isAutomationGestureActive"
    | "emitAutomationWindowOpen"
    | "sessionPolicy"
    | "window"
    | "ensureWorkspace"
    | "createLiveRuntime"
    | "runtimes"
    | "clearTabSuspendTimer"
    | "disposed"
    | "markThreadStateChanged"
    | "getVisibleBoundsForThread"
    | "activeThreadId"
    | "attachRuntime"
    | "emitState"
    | "states"
    | "closeAutomationTab"
    | "popupRuntimes"
    | "getAutomationHumanControlEpoch"
    | "automationSideEffectProvenanceByRuntimeKey"
    | "emitAutomationDownload"
    | "pendingWindowOpenTasksByRuntimeKey"
    | "pendingAutomationWindowOpenCommitsByRuntimeKey"
    | "newTab"
    | "attachActiveTab"
    | "automationRuntimeKeys"
    | "pendingStatePublicationsByKey"
    | "markHumanControl"
  >,
) {
  function configureWindowOpenHandling(
    webContents: WebContents,
    context: OAuthPopupContext,
    listenerDisposers: Array<() => void>,
  ): void {
    const { threadId, tabId } = context;

    const blockUnsafeMainFrameNavigation = (
      details: Electron.Event<
        Electron.WebContentsWillNavigateEventParams | Electron.WebContentsWillRedirectEventParams
      >,
      legacyUrl?: string,
      _legacyIsSameDocument?: boolean,
      legacyIsMainFrame?: boolean,
    ) => {
      const url = typeof details.url === "string" ? details.url : (legacyUrl ?? "");
      const isMainFrame =
        typeof details.isMainFrame === "boolean"
          ? details.isMainFrame
          : legacyIsMainFrame !== false;
      if (isMainFrame && !isAllowedBrowserRuntimeNavigation(url, webContents.getURL())) {
        details.preventDefault();
      }
    };
    webContents.on("will-navigate", blockUnsafeMainFrameNavigation);
    webContents.on("will-redirect", blockUnsafeMainFrameNavigation);
    listenerDisposers.push(() => {
      webContents.removeListener("will-navigate", blockUnsafeMainFrameNavigation);
      webContents.removeListener("will-redirect", blockUnsafeMainFrameNavigation);
    });

    // Auth providers can chain web popups (provider -> consent). Page-controlled custom schemes are
    // denied here: browser content must never launch an OS handler implicitly.
    webContents.setWindowOpenHandler((details) => {
      const { url } = details;
      const automationGestureActive = hostRuntime.isAutomationGestureActive(threadId, tabId);
      const isWebUrl =
        url.startsWith("http://") || url.startsWith("https://") || url === ABOUT_BLANK_URL;
      if (!isWebUrl) {
        if (automationGestureActive) {
          hostRuntime.emitAutomationWindowOpen({
            threadId,
            sourceTabId: tabId,
            kind: "blocked",
            openedTabId: null,
          });
        }
        return { action: "deny" };
      }

      const kind = classifyBrowserWindowOpen({
        url,
        frameName: details.frameName,
        features: details.features,
        disposition: details.disposition,
      });
      if (kind === "popup") {
        if (automationGestureActive) {
          hostRuntime.emitAutomationWindowOpen({
            threadId,
            sourceTabId: tabId,
            kind: "popup",
            openedTabId: null,
          });
        }

        return {
          action: "allow",
          overrideBrowserWindowOptions: hostRuntime.sessionPolicy.buildOAuthPopupWindowOptions(
            hostRuntime.window,
          ),
          createWindow: (options) => createEmbeddedPopup({ threadId, tabId }, options, url),
        };
      }

      scheduleWindowOpenTab({
        threadId,
        sourceTabId: tabId,
        sourceWebContents: webContents,
        url,
        automationGestureActive,
      });
      return { action: "deny" };
    });

    const didCreateWindow = (childWindow: BrowserWindow) => {
      registerOAuthPopupWindow(childWindow, { threadId, tabId });
    };
    webContents.on("did-create-window", didCreateWindow);
    listenerDisposers.push(() => {
      webContents.removeListener("did-create-window", didCreateWindow);
    });
  }

  function createEmbeddedPopup(
    opener: OAuthPopupContext,
    options: EmbeddedPopupOptions,
    url: string,
  ): WebContents {
    const state = hostRuntime.ensureWorkspace(opener.threadId);
    const tab = createBrowserTab(url);
    tab.openerTabId = opener.tabId;
    tab.status = "live";
    tab.isLoading = true;
    const runtime = hostRuntime.createLiveRuntime(opener.threadId, tab.id, options);
    state.tabs.push(tab);
    runtime.popupOpenerTabId = opener.tabId;
    hostRuntime.runtimes.set(runtime.key, runtime);
    inheritAutomationDownloadProvenance(opener, runtime.key);
    hostRuntime.clearTabSuspendTimer(opener.threadId, opener.tabId);
    const close = (event: Electron.Event) => {
      event.preventDefault();
      closeEmbeddedPopup(runtime);
    };
    const popupEvents: NodeJS.EventEmitter = runtime.webContents;
    popupEvents.on("close", close);
    runtime.listenerDisposers.push(() => popupEvents.removeListener("close", close));

    setImmediate(() => {
      if (hostRuntime.disposed || hostRuntime.runtimes.get(runtime.key) !== runtime) return;
      state.activeTabId = tab.id;
      hostRuntime.markThreadStateChanged(opener.threadId);
      const bounds = hostRuntime.getVisibleBoundsForThread(opener.threadId);
      if (hostRuntime.activeThreadId === opener.threadId && bounds)
        hostRuntime.attachRuntime(runtime, bounds);
      hostRuntime.emitState(opener.threadId);

      if (!options.webContents) {
        void runtime.webContents.loadURL(url).catch(() => {});
      }
    });
    return runtime.webContents;
  }

  function closeEmbeddedPopup(runtime: LiveTabRuntime): void {
    if (hostRuntime.runtimes.get(runtime.key) !== runtime) return;
    const state = hostRuntime.states.get(runtime.threadId);
    if (!state?.tabs.some((tab) => tab.id === runtime.tabId)) return;
    if (
      state.activeTabId === runtime.tabId &&
      state.tabs.some((tab) => tab.id === runtime.popupOpenerTabId)
    ) {
      state.activeTabId = runtime.popupOpenerTabId!;
    }
    hostRuntime.closeAutomationTab({ threadId: runtime.threadId, tabId: runtime.tabId });
  }

  function hasEmbeddedPopup(threadId: ThreadId, tabId: string): boolean {
    return [...hostRuntime.runtimes.values()].some(
      (runtime) => runtime.threadId === threadId && runtime.popupOpenerTabId === tabId,
    );
  }

  function isEmbeddedPopupFamily(threadId: ThreadId, tabId: string): boolean {
    return (
      Boolean(hostRuntime.runtimes.get(buildRuntimeKey(threadId, tabId))?.popupOpenerTabId) ||
      hasEmbeddedPopup(threadId, tabId)
    );
  }

  function findRuntimeContext(webContents: WebContents): OAuthPopupContext | null {
    for (const runtime of hostRuntime.runtimes.values()) {
      if (runtime.webContents === webContents) {
        return { threadId: runtime.threadId, tabId: runtime.tabId };
      }
    }
    for (const popup of hostRuntime.popupRuntimes.values()) {
      if (!popup.window.isDestroyed() && popup.window.webContents === webContents) {
        return { threadId: popup.threadId, tabId: popup.tabId };
      }
    }
    return null;
  }

  function handleSessionDownload(input: BrowserSessionDownloadEvent): void {
    if (hostRuntime.disposed) return;
    const context = findRuntimeContext(input.webContents);
    if (!context) {
      return;
    }
    const runtimeKey = buildRuntimeKey(context.threadId, context.tabId);
    const currentHumanEpoch = hostRuntime.getAutomationHumanControlEpoch(context.threadId);
    const provenance = hostRuntime.automationSideEffectProvenanceByRuntimeKey.get(runtimeKey);
    if (!provenance || provenance.humanControlEpoch !== currentHumanEpoch) {
      return;
    }

    // Electron guarantees that preventing `will-download` cancels before a target path is selected or
    // bytes are written. Notify the host only after the side effect has been contained so listener
    // failures cannot leak it.
    input.event.preventDefault();
    hostRuntime.emitAutomationDownload({
      threadId: context.threadId,
      sourceTabId: context.tabId,
    });
  }

  function inheritAutomationDownloadProvenance(opener: OAuthPopupContext, childKey: string): void {
    const provenance = hostRuntime.automationSideEffectProvenanceByRuntimeKey.get(
      buildRuntimeKey(opener.threadId, opener.tabId),
    );
    if (
      provenance?.humanControlEpoch === hostRuntime.getAutomationHumanControlEpoch(opener.threadId)
    ) {
      hostRuntime.automationSideEffectProvenanceByRuntimeKey.set(childKey, { ...provenance });
    }
  }

  function scheduleWindowOpenTab(input: {
    readonly threadId: ThreadId;
    readonly sourceTabId: string;
    readonly sourceWebContents: WebContents;
    readonly url: string;
    readonly automationGestureActive: boolean;
  }): void {
    if (hostRuntime.disposed) return;
    const key = buildRuntimeKey(input.threadId, input.sourceTabId);

    if (
      hostRuntime.pendingWindowOpenTasksByRuntimeKey.has(key) ||
      hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.has(key)
    )
      return;

    const handle = setImmediate(() => {
      const pending = hostRuntime.pendingWindowOpenTasksByRuntimeKey.get(key);
      if (!pending || pending.handle !== handle) return;
      hostRuntime.pendingWindowOpenTasksByRuntimeKey.delete(key);
      if (
        hostRuntime.disposed ||
        input.sourceWebContents.isDestroyed() ||
        !isCurrentWindowOpenSource(input.threadId, input.sourceTabId, input.sourceWebContents)
      ) {
        return;
      }
      const sourceState = hostRuntime.states.get(input.threadId);
      if (!sourceState?.open || !sourceState.tabs.some((tab) => tab.id === input.sourceTabId)) {
        return;
      }

      if (input.automationGestureActive) {
        const tab = createBrowserTab(normalizeUrlInput(input.url));
        const fallbackTimer = setTimeout(() => {
          commitPendingAutomationWindowOpen(key);
        }, BROWSER_AUTOMATION_WINDOW_OPEN_FALLBACK_MS);
        fallbackTimer.unref?.();
        hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.set(key, {
          threadId: input.threadId,
          sourceTabId: input.sourceTabId,
          sourceWebContents: input.sourceWebContents,
          tab,
          fallbackTimer,
        });
        hostRuntime.emitAutomationWindowOpen({
          threadId: input.threadId,
          sourceTabId: input.sourceTabId,
          kind: "tab",
          openedTabId: tab.id,
        });
      } else {
        hostRuntime.newTab({
          threadId: input.threadId,
          url: input.url,
          activate: true,
        });
      }
      if (!input.automationGestureActive) {
        const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
        if (hostRuntime.activeThreadId === input.threadId && bounds) {
          hostRuntime.attachActiveTab(input.threadId, bounds);
        }
      }
    });
    handle.unref?.();
    hostRuntime.pendingWindowOpenTasksByRuntimeKey.set(key, {
      handle,
      sourceWebContents: input.sourceWebContents,
    });
  }

  function isCurrentWindowOpenSource(
    threadId: ThreadId,
    tabId: string,
    webContents: WebContents,
  ): boolean {
    const runtime = hostRuntime.runtimes.get(buildRuntimeKey(threadId, tabId));
    if (runtime?.webContents === webContents) return true;
    for (const popup of hostRuntime.popupRuntimes.values()) {
      if (
        popup.threadId === threadId &&
        popup.tabId === tabId &&
        popup.window.webContents === webContents
      ) {
        return true;
      }
    }
    return false;
  }

  function commitPendingAutomationWindowOpen(key: string): void {
    const pending = hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.get(key);
    if (!pending) return;
    hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.delete(key);
    clearTimeout(pending.fallbackTimer);
    if (
      hostRuntime.disposed ||
      pending.sourceWebContents.isDestroyed() ||
      !isCurrentWindowOpenSource(pending.threadId, pending.sourceTabId, pending.sourceWebContents)
    ) {
      return;
    }
    const state = hostRuntime.states.get(pending.threadId);
    if (
      !state?.open ||
      !state.tabs.some((tab) => tab.id === pending.sourceTabId) ||
      state.tabs.some((tab) => tab.id === pending.tab.id)
    ) {
      return;
    }

    state.tabs = [...state.tabs, pending.tab];
    state.activeTabId = pending.tab.id;
    pending.tab.runtimeSurface = "native";
    const openedRuntimeKey = buildRuntimeKey(pending.threadId, pending.tab.id);
    hostRuntime.automationRuntimeKeys.add(openedRuntimeKey);
    inheritAutomationDownloadProvenance(
      { threadId: pending.threadId, tabId: pending.sourceTabId },
      openedRuntimeKey,
    );
    syncThreadLastError(state);
    hostRuntime.markThreadStateChanged(pending.threadId);
    // The host can now reconcile openedTabId from canonical state, but the renderer must not remove the
    // source guest until Electron has completely unwound the native window-open activation and the
    // click response.
    scheduleDeferredStatePublication(key, pending.threadId, true, undefined, pending.tab.id);
  }

  function scheduleDeferredStatePublication(
    key: string,
    threadId: ThreadId,
    reattachActiveTab: boolean,
    rendererGuestToReset?: WebContents,
    initialNavigationTabId?: string,
  ): void {
    if (hostRuntime.disposed || hostRuntime.pendingStatePublicationsByKey.has(key)) return;
    const handle = setTimeout(() => {
      const pending = hostRuntime.pendingStatePublicationsByKey.get(key);
      if (!pending || pending.handle !== handle) return;
      hostRuntime.pendingStatePublicationsByKey.delete(key);
      if (hostRuntime.disposed || !hostRuntime.states.has(threadId)) return;
      if (pending.rendererGuestToReset && !pending.rendererGuestToReset.isDestroyed()) {
        void pending.rendererGuestToReset.loadURL(ABOUT_BLANK_URL).catch(() => {});
      }
      hostRuntime.emitState(threadId);
      const bounds = pending.reattachActiveTab
        ? hostRuntime.getVisibleBoundsForThread(threadId)
        : null;
      if (pending.reattachActiveTab && hostRuntime.activeThreadId === threadId && bounds) {
        const initialTabId = pending.initialNavigationTabId;
        const needsInitialNavigation =
          initialTabId !== undefined &&
          hostRuntime.states.get(threadId)?.activeTabId === initialTabId &&
          !hostRuntime.runtimes.get(buildRuntimeKey(threadId, initialTabId))?.webContents.getURL();
        hostRuntime.attachActiveTab(threadId, bounds, { forceLoad: needsInitialNavigation });
      }
    }, BROWSER_DEFERRED_PUBLICATION_DELAY_MS);

    hostRuntime.pendingStatePublicationsByKey.set(key, {
      handle,
      threadId,
      reattachActiveTab,
      ...(initialNavigationTabId ? { initialNavigationTabId } : {}),
      ...(rendererGuestToReset ? { rendererGuestToReset } : {}),
    });
  }

  function discardPendingAutomationWindowOpen(key: string): void {
    const pending = hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.get(key);
    if (!pending) return;
    clearTimeout(pending.fallbackTimer);
    hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.delete(key);
  }

  function clearPendingWindowOpenTask(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const pending = hostRuntime.pendingWindowOpenTasksByRuntimeKey.get(key);
    if (pending) {
      clearImmediate(pending.handle);
      hostRuntime.pendingWindowOpenTasksByRuntimeKey.delete(key);
    }
    discardPendingAutomationWindowOpen(key);
    const publication = hostRuntime.pendingStatePublicationsByKey.get(key);
    if (publication) {
      clearTimeout(publication.handle);
      hostRuntime.pendingStatePublicationsByKey.delete(key);
    }
  }

  function clearAllPendingWindowOpenTasks(): void {
    for (const pending of hostRuntime.pendingWindowOpenTasksByRuntimeKey.values()) {
      clearImmediate(pending.handle);
    }
    hostRuntime.pendingWindowOpenTasksByRuntimeKey.clear();
    for (const pending of hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.values()) {
      clearTimeout(pending.fallbackTimer);
    }
    hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey.clear();
    for (const pending of hostRuntime.pendingStatePublicationsByKey.values()) {
      clearTimeout(pending.handle);
    }
    hostRuntime.pendingStatePublicationsByKey.clear();
  }

  function registerOAuthPopupWindow(popup: BrowserWindow, context: OAuthPopupContext): void {
    if (hostRuntime.popupRuntimes.has(popup)) {
      return;
    }
    const runtime: OAuthPopupRuntime = {
      ...context,
      window: popup,
      listenerDisposers: [],
    };
    hostRuntime.popupRuntimes.set(popup, runtime);
    popup.setMenuBarVisibility(false);
    configureOAuthPopupRuntime(runtime);
    centerPopupWindow(runtime);
  }

  function configureOAuthPopupRuntime(runtime: OAuthPopupRuntime): void {
    const { window: popup } = runtime;
    const { webContents } = popup;
    hostRuntime.sessionPolicy.applyUserAgent(webContents);
    const closeOnInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== "keyDown") {
        return;
      }
      hostRuntime.markHumanControl(runtime.threadId);
      const key = input.key.toLowerCase();
      const isCloseChord =
        key === "escape" ||
        (key === "w" && !input.shift && !input.alt && (input.meta || input.control));
      if (!isCloseChord) {
        return;
      }
      event.preventDefault();
      closePopupRuntime(runtime);
    };
    webContents.on("before-input-event", closeOnInput);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-input-event", closeOnInput);
    });

    const markPopupPointerControl = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (
        input.type === "mouseDown" ||
        input.type === "mouseWheel" ||
        input.type === "contextMenu"
      ) {
        hostRuntime.markHumanControl(runtime.threadId);
      }
    };
    webContents.on("before-mouse-event", markPopupPointerControl);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-mouse-event", markPopupPointerControl);
    });

    configureWindowOpenHandling(webContents, runtime, runtime.listenerDisposers);

    popup.once("closed", () => {
      removePopupRuntime(runtime);
    });
  }

  function removePopupRuntime(runtime: OAuthPopupRuntime): void {
    if (hostRuntime.popupRuntimes.get(runtime.window) !== runtime) {
      return;
    }
    for (const dispose of runtime.listenerDisposers.splice(0)) {
      dispose();
    }
    hostRuntime.popupRuntimes.delete(runtime.window);
  }

  function closePopupRuntime(runtime: OAuthPopupRuntime): void {
    removePopupRuntime(runtime);
    if (!runtime.window.isDestroyed()) {
      runtime.window.destroy();
    }
  }

  function centerPopupWindow(runtime: OAuthPopupRuntime): void {
    const parent = hostRuntime.window;
    const popup = runtime.window;
    if (!parent || parent.isDestroyed() || popup.isDestroyed()) {
      return;
    }
    const parentBounds = parent.getBounds();
    const popupBounds = popup.getBounds();
    const nextBounds = {
      x: Math.round(parentBounds.x + (parentBounds.width - popupBounds.width) / 2),
      y: Math.round(parentBounds.y + (parentBounds.height - popupBounds.height) / 2),
      width: popupBounds.width,
      height: popupBounds.height,
    };
    if (
      popupBounds.x === nextBounds.x &&
      popupBounds.y === nextBounds.y &&
      popupBounds.width === nextBounds.width &&
      popupBounds.height === nextBounds.height
    ) {
      return;
    }
    popup.setBounds(nextBounds);
  }

  function updatePopupWindowsForThread(threadId: ThreadId): void {
    for (const runtime of hostRuntime.popupRuntimes.values()) {
      if (runtime.threadId === threadId) {
        centerPopupWindow(runtime);
      }
    }
  }

  function closePopupWindowsWhere(shouldClose: (runtime: OAuthPopupRuntime) => boolean): void {
    for (const runtime of [...hostRuntime.popupRuntimes.values()]) {
      if (shouldClose(runtime)) {
        closePopupRuntime(runtime);
      }
    }
  }

  function closePopupWindowsForThread(threadId: ThreadId): void {
    closePopupWindowsWhere((runtime) => runtime.threadId === threadId);
  }

  function closePopupWindowsForTab(threadId: ThreadId, tabId: string): void {
    closePopupWindowsWhere((runtime) => runtime.threadId === threadId && runtime.tabId === tabId);
  }

  function closeAllPopupWindows(): void {
    closePopupWindowsWhere(() => true);
  }

  return {
    configureOAuthPopupRuntime,
    configureWindowOpenHandling,
    closeEmbeddedPopup,
    isEmbeddedPopupFamily,
    handleSessionDownload,
    commitPendingAutomationWindowOpen,
    scheduleDeferredStatePublication,
    clearPendingWindowOpenTask,
    clearAllPendingWindowOpenTasks,
    updatePopupWindowsForThread,
    closePopupWindowsForThread,
    closePopupWindowsForTab,
    closeAllPopupWindows,
  };
}
