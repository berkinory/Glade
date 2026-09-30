import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  BrowserAttachWebviewInput,
  BrowserDetachWebviewInput,
  ThreadBrowserState,
} from "@glade/contracts/ipc/ipc";
import { normalizeBrowserUrlInput as normalizeUrlInput } from "@glade/shared/browser/browserSession";
import { isBrowserCopyLinkChord } from "@glade/shared/browser/browserShortcuts";
import {
  session as electronSession,
  webContents as electronWebContents,
  WebContentsView,
} from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { BROWSER_SESSION_PARTITION } from "./browserSessionPolicy";
import {
  BACKGROUND_AUTOMATION_BOUNDS,
  BROWSER_ERROR_ABORTED,
  buildRuntimeKey,
  defaultTitleForUrl,
  EmbeddedPopupOptions,
  LIVE_TAB_STATUS,
  LiveTabRuntime,
  mapBrowserLoadError,
  suspendTabState,
  syncThreadLastError,
} from "./browserTabState";
import { isLocalFileUrl } from "./localHtmlPreviewProtocol";

export function createBrowserWebviewRuntime(
  hostRuntime: Pick<
    BrowserRuntime,
    | "states"
    | "getTab"
    | "window"
    | "isNativeAutomationTab"
    | "snapshotThreadState"
    | "promoteTabToRendererSurface"
    | "findRendererRuntimeByWebContentsId"
    | "destroyRuntime"
    | "runtimes"
    | "rendererOnlyRuntimeKeys"
    | "getVisibleBoundsForThread"
    | "attachRuntime"
    | "sessionPolicy"
    | "loadTab"
    | "markThreadStateChanged"
    | "queueRuntimeStateSync"
    | "emitState"
    | "options"
    | "parkHiddenRuntime"
    | "configureWindowOpenHandling"
    | "consumeExpectedAutomationInput"
    | "markHumanControl"
    | "copyTabLink"
    | "annotations"
    | "closeEmbeddedPopup"
    | "activeThreadId"
    | "attachActiveTab"
  >,
) {
  function attachWebview(
    input: BrowserAttachWebviewInput,
    hostWebContentsId: number,
  ): ThreadBrowserState {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state?.open || !tab) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    if (state.activeTabId !== tab.id) {
      throw new Error("A visible browser webview can only attach to the active tab.");
    }
    const webContents = electronWebContents.fromId(input.webContentsId);
    if (!webContents || webContents.isDestroyed()) {
      throw new Error("The visible browser webview is not available.");
    }
    if (
      webContents.getType() !== "webview" ||
      webContents.hostWebContents?.id !== hostWebContentsId ||
      (hostRuntime.window !== null && hostWebContentsId !== hostRuntime.window.webContents.id) ||
      webContents.session !== electronSession.fromPartition(BROWSER_SESSION_PARTITION)
    ) {
      throw new Error("The browser webview does not belong to this Glade window and partition.");
    }

    if (hostRuntime.isNativeAutomationTab(input.threadId, tab.id)) {
      return hostRuntime.snapshotThreadState(input.threadId, state);
    }

    hostRuntime.promoteTabToRendererSurface(input.threadId, tab.id);

    const key = buildRuntimeKey(input.threadId, tab.id);
    const existingRendererRuntime = hostRuntime.findRendererRuntimeByWebContentsId(webContents.id);
    if (existingRendererRuntime && existingRendererRuntime.key !== key) {
      hostRuntime.destroyRuntime(existingRendererRuntime.threadId, existingRendererRuntime.tabId, {
        preserveRendererDebugger: true,
        annotationReason: "replaced",
      });
    }

    const existing = hostRuntime.runtimes.get(key);
    if (existing?.webContents.id !== webContents.id) {
      if (existing) {
        if (!existing.ownsWebContents && !existing.webContents.isDestroyed()) {
          throw new Error("This browser tab is already attached to another visible webview.");
        }
        hostRuntime.destroyRuntime(input.threadId, tab.id, {
          preserveAutomationDownloadTracking: true,
          annotationReason: "replaced",
        });
      }
      const runtime: LiveTabRuntime = {
        key,
        threadId: input.threadId,
        tabId: tab.id,
        webContents,
        view: null,
        ownsWebContents: false,
        listenerDisposers: [],
      };
      configureRuntimeWebContents(runtime);
      hostRuntime.runtimes.set(key, runtime);
    }
    hostRuntime.rendererOnlyRuntimeKeys.add(key);

    const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
    const runtime = hostRuntime.runtimes.get(key);
    if (runtime && bounds) {
      hostRuntime.attachRuntime(runtime, bounds);
    }

    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const requiresLocalPreviewBootstrap =
      isLocalFileUrl(expectedUrl) &&
      hostRuntime.sessionPolicy.resolveDisplayUrl(webContents.getURL()) !== expectedUrl;
    if (requiresLocalPreviewBootstrap) {
      void hostRuntime.loadTab(input.threadId, tab.id, {
        force: true,
        ...(runtime ? { runtime } : {}),
      });
      return hostRuntime.snapshotThreadState(input.threadId, state);
    }

    const didChange =
      tab.status !== LIVE_TAB_STATUS || tab.lastError !== null || tab.runtimeSurface !== "renderer";
    tab.status = LIVE_TAB_STATUS;
    tab.lastError = null;
    tab.runtimeSurface = "renderer";
    const nextDidChange = syncThreadLastError(state) || didChange;
    if (nextDidChange) {
      hostRuntime.markThreadStateChanged(input.threadId);
    }
    hostRuntime.queueRuntimeStateSync(input.threadId, tab.id);
    if (nextDidChange) {
      hostRuntime.emitState(input.threadId);
    }
    return hostRuntime.snapshotThreadState(input.threadId, state);
  }

  function detachWebview(input: BrowserDetachWebviewInput): void {
    const state = hostRuntime.states.get(input.threadId);
    const tab = state ? hostRuntime.getTab(state, input.tabId) : null;
    if (!state || !tab) {
      return;
    }

    const runtime = hostRuntime.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
    if (!runtime || runtime.ownsWebContents || runtime.webContents.id !== input.webContentsId) {
      return;
    }

    hostRuntime.destroyRuntime(input.threadId, input.tabId);
    hostRuntime.rendererOnlyRuntimeKeys.delete(buildRuntimeKey(input.threadId, input.tabId));
    const didChange = suspendTabState(tab) || syncThreadLastError(state);
    if (didChange) {
      hostRuntime.markThreadStateChanged(input.threadId);
      hostRuntime.emitState(input.threadId);
    }
  }

  function createLiveRuntime(
    threadId: ThreadId,
    tabId: string,
    popupOptions?: EmbeddedPopupOptions,
  ): LiveTabRuntime {
    const view = new WebContentsView({
      ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}),
      webPreferences: {
        ...popupOptions?.webPreferences,
        partition: BROWSER_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        ...(hostRuntime.options.annotationPreloadPath
          ? { preload: hostRuntime.options.annotationPreloadPath }
          : {}),
      },
    });
    const runtime: LiveTabRuntime = {
      key: buildRuntimeKey(threadId, tabId),
      threadId,
      tabId,
      webContents: view.webContents,
      view,
      ownsWebContents: true,
      listenerDisposers: [],
    };
    if (hostRuntime.window && !popupOptions?.webContents) {
      // Size the new blank view before hiding it; initially hidden Electron views otherwise keep a
      // zero-sized renderer. No site has loaded yet.
      hostRuntime.window.contentView.addChildView(view);
      view.setBounds({ ...BACKGROUND_AUTOMATION_BOUNDS });
    }
    if (hostRuntime.window) {
      hostRuntime.parkHiddenRuntime(runtime, BACKGROUND_AUTOMATION_BOUNDS);
    }
    configureRuntimeWebContents(runtime);
    return runtime;
  }

  function configureRuntimeWebContents(runtime: LiveTabRuntime): void {
    const { threadId, tabId, webContents } = runtime;
    const releaseObserver = hostRuntime.options.onRuntimeReady?.({ threadId, tabId, webContents });
    if (releaseObserver) runtime.listenerDisposers.push(releaseObserver);

    hostRuntime.sessionPolicy.applyUserAgent(webContents);

    hostRuntime.configureWindowOpenHandling(webContents, runtime, runtime.listenerDisposers);

    const beforeInputEvent = (event: Electron.Event, input: Electron.Input) => {
      if (hostRuntime.options.beforeInputEvent?.(event, input)) {
        return;
      }
      if (input.type !== "keyDown") {
        return;
      }
      if (
        hostRuntime.consumeExpectedAutomationInput(threadId, tabId, {
          kind: "key",
          key: input.key,
          alt: input.alt === true,
          control: input.control === true,
          meta: input.meta === true,
          shift: input.shift === true,
        })
      ) {
        return;
      }
      hostRuntime.markHumanControl(threadId);
      const matches = isBrowserCopyLinkChord(
        {
          meta: input.meta,
          ctrl: input.control,
          shift: input.shift,
          alt: input.alt,
          key: input.key,
        },
        process.platform === "darwin",
      );
      if (!matches) {
        return;
      }
      event.preventDefault();
      hostRuntime.copyTabLink(threadId, tabId);
    };
    webContents.on("before-input-event", beforeInputEvent);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-input-event", beforeInputEvent);
    });

    const beforeMouseEvent = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (
        input.type === "mouseDown" ||
        input.type === "mouseWheel" ||
        input.type === "contextMenu"
      ) {
        if (
          hostRuntime.consumeExpectedAutomationInput(threadId, tabId, {
            kind: "mouse",
            type: input.type,
            x: input.x,
            y: input.y,
            ...(input.button === undefined ? {} : { button: input.button }),
          })
        ) {
          return;
        }
        hostRuntime.markHumanControl(threadId);
      }
    };
    webContents.on("before-mouse-event", beforeMouseEvent);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-mouse-event", beforeMouseEvent);
    });

    const pageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault();
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
    };
    webContents.on("page-title-updated", pageTitleUpdated);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("page-title-updated", pageTitleUpdated);
    });

    const pageFaviconUpdated = (_event: Electron.Event, faviconUrls: string[]) => {
      hostRuntime.queueRuntimeStateSync(threadId, tabId, faviconUrls);
    };
    webContents.on("page-favicon-updated", pageFaviconUpdated);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("page-favicon-updated", pageFaviconUpdated);
    });

    const didStartLoading = () => {
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
    };
    webContents.on("did-start-loading", didStartLoading);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-start-loading", didStartLoading);
    });

    const didStopLoading = () => {
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
      hostRuntime.annotations.recoverNavigation(threadId, tabId, webContents.id);
    };
    webContents.on("did-stop-loading", didStopLoading);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-stop-loading", didStopLoading);
    });

    const didNavigate = () => {
      const state = hostRuntime.states.get(threadId);
      const tab = state ? hostRuntime.getTab(state, tabId) : null;
      if (state && tab && tab.lastError !== null) {
        tab.lastError = null;
        syncThreadLastError(state);
        hostRuntime.markThreadStateChanged(threadId);
        hostRuntime.emitState(threadId);
      }
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
    };
    webContents.on("did-navigate", didNavigate);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-navigate", didNavigate);
    });

    const didStartNavigation = (
      _event: Electron.Event,
      _url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && !_isInPlace) {
        hostRuntime.annotations.handleNavigation(threadId, tabId, webContents.id);
      }
    };
    webContents.on("did-start-navigation", didStartNavigation);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-start-navigation", didStartNavigation);
    });

    const didNavigateInPage = () => {
      hostRuntime.queueRuntimeStateSync(threadId, tabId);
      hostRuntime.annotations.handleInPageNavigation(threadId, tabId, webContents.id);
    };
    webContents.on("did-navigate-in-page", didNavigateInPage);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-navigate-in-page", didNavigateInPage);
    });

    const didFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) {
        return;
      }
      hostRuntime.annotations.recoverNavigation(threadId, tabId, webContents.id);
      if (errorCode === BROWSER_ERROR_ABORTED) return;

      const state = hostRuntime.states.get(threadId);
      const tab = state ? hostRuntime.getTab(state, tabId) : null;
      if (!state || !tab) {
        return;
      }

      tab.url = validatedURL ? hostRuntime.sessionPolicy.resolveDisplayUrl(validatedURL) : tab.url;
      tab.title = defaultTitleForUrl(tab.url);
      tab.isLoading = false;
      tab.lastError = mapBrowserLoadError(errorCode);
      syncThreadLastError(state);
      hostRuntime.markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    };
    webContents.on("did-fail-load", didFailLoad);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-fail-load", didFailLoad);
    });

    let runtimeLossHandled = false;
    const handleRuntimeLoss = () => {
      // Only the runtime that installed this handler may invalidate the logical tab; a late event from an
      // old guest must not tear down a replacement already stored under the same runtime key.
      if (runtimeLossHandled || hostRuntime.runtimes.get(runtime.key) !== runtime) {
        return;
      }
      runtimeLossHandled = true;
      if (runtime.popupOpenerTabId) {
        hostRuntime.closeEmbeddedPopup(runtime);
        return;
      }
      const state = hostRuntime.states.get(threadId);
      const tab = state ? hostRuntime.getTab(state, tabId) : null;
      hostRuntime.destroyRuntime(threadId, tabId);
      if (state && tab) {
        tab.status = "suspended";
        tab.isLoading = false;
        tab.lastError = "This tab stopped unexpectedly.";
        syncThreadLastError(state);
        hostRuntime.markThreadStateChanged(threadId);
        hostRuntime.emitState(threadId);
      }
      const bounds = hostRuntime.getVisibleBoundsForThread(threadId);
      if (hostRuntime.activeThreadId === threadId && bounds) {
        hostRuntime.attachActiveTab(threadId, bounds);
      }
    };
    webContents.on("render-process-gone", handleRuntimeLoss);
    webContents.on("destroyed", handleRuntimeLoss);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("render-process-gone", handleRuntimeLoss);
      webContents.removeListener("destroyed", handleRuntimeLoss);
    });
  }

  return { configureRuntimeWebContents, attachWebview, detachWebview, createLiveRuntime };
}
