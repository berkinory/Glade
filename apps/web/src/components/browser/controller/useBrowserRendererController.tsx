import { type ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { BROWSER_BLANK_URL } from "@glade/shared/browser/browserSession";
import { useEffect, useLayoutEffect } from "react";
import {
  applyBrowserWebviewPresentation,
  browserAddressDisplayValue,
  browserWebviewInitialUrl,
  createBrowserRendererLossHandler,
  resolveBrowserAddressSync,
} from "~/components/BrowserPanel.logic";
import {
  BROWSER_PERF_SAMPLE_INTERVAL_MS,
  BROWSER_WEBVIEW_PARTITION,
  BrowserPanelProps,
  BrowserWebviewElement,
  GLADE_BROWSER_LABEL,
  browserPanelHideScheduler,
  browserPanelRendererHandoff,
  isBrowserPerfLoggingEnabled,
} from "./browserPanelSupport";
import type { useBrowserStateController } from "./useBrowserStateController";
export function useBrowserRendererController({
  state,
  props,
}: {
  state: ReturnType<typeof useBrowserStateController>;
  props: BrowserPanelProps;
}) {
  const {
    api,
    isLiveRuntime,
    upsertThreadState,
    setWorkspaceReady,
    setLocalError,
    runBrowserAction,
    activeTab,
    previousActiveTabIdRef,
    addressDraftsByTabIdRef,
    lastSyncedAddressByTabIdRef,
    isAddressEditingRef,
    setAddressValue,
    workspaceReady,
    activeTabId,
    showLocalServersHome,
    usesNativeRuntime,
    rendererHasPopup,
    browserWebviewStageRef,
    detachRendererBrowserWebview,
    browserViewportRef,
    isFloatingMode,
    browserWebviewRef,
    browserRendererGeneration,
    browserWebviewWebContentsIdRef,
    activeTabInitialUrlRef,
    browserWebviewTabIdRef,
    browserWebviewAttachKeyRef,
    browserWebviewAttachInFlightKeyRef,
    setBrowserRendererGeneration,
    threadBrowserState,
    perfCountersRef,
  } = state;
  const { threadId } = props;

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    return api.browser.onState((state) => {
      upsertThreadState(state);
    });
  }, [api, isLiveRuntime, upsertThreadState]);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    const releaseLiveHost = browserPanelHideScheduler.acquire(threadId);

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      setWorkspaceReady(false);
      setLocalError(null);

      void runBrowserAction(() => api.browser.open({ threadId })).then((state) => {
        if (cancelled) {
          return;
        }
        if (!state) {
          setWorkspaceReady(true);
          return;
        }
        upsertThreadState(state);
        setWorkspaceReady(true);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      releaseLiveHost();
      browserPanelHideScheduler.schedule(threadId, () => {
        void api.browser.hide({ threadId });
      });
    };
  }, [
    api,
    isLiveRuntime,
    runBrowserAction,
    threadId,
    upsertThreadState,
    setWorkspaceReady,
    setLocalError,
  ]);

  useEffect(() => {
    const activeTabId = activeTab?.id ?? null;
    const nextDisplayValue = browserAddressDisplayValue(activeTab);
    const decision = resolveBrowserAddressSync({
      activeTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeTabId ? addressDraftsByTabIdRef.current.get(activeTabId) : undefined,
      nextDisplayValue,
      lastSyncedValue: activeTabId
        ? lastSyncedAddressByTabIdRef.current.get(activeTabId)
        : undefined,
      isEditing: isAddressEditingRef.current,
    });

    if (decision.type === "replace") {
      setAddressValue(decision.value);
      if (activeTabId) {
        addressDraftsByTabIdRef.current.set(activeTabId, decision.value);
        if (decision.syncedValue !== undefined) {
          lastSyncedAddressByTabIdRef.current.set(activeTabId, decision.syncedValue);
        }
      }
    }

    previousActiveTabIdRef.current = activeTabId;
  }, [
    activeTab,
    previousActiveTabIdRef,
    addressDraftsByTabIdRef,
    lastSyncedAddressByTabIdRef,
    isAddressEditingRef,
    setAddressValue,
  ]);

  useLayoutEffect(() => {
    if (!api || !isLiveRuntime || !workspaceReady || !activeTabId) {
      return;
    }

    if (showLocalServersHome || usesNativeRuntime) {
      if (rendererHasPopup && browserWebviewStageRef.current) {
        browserWebviewStageRef.current.style.visibility = "hidden";
        return;
      }
      detachRendererBrowserWebview();
      return;
    }

    const host = browserViewportRef.current;
    if (!host) {
      return;
    }

    let stage = browserWebviewStageRef.current;
    if (!stage) {
      stage = document.createElement("div");
      stage.dataset.floatingBrowserStage = "true";
      browserWebviewStageRef.current = stage;
    }
    if (stage.parentElement !== host) {
      host.append(stage);
    }
    stage.style.visibility = "visible";
    stage.style.pointerEvents = isFloatingMode ? "none" : "";
    stage.inert = isFloatingMode;

    let webview = browserWebviewRef.current;
    if (!webview) {
      webview = document.createElement("webview") as BrowserWebviewElement;
      webview.className = "h-full w-full";
      webview.style.display = "flex";
      webview.style.width = "100%";
      webview.style.height = "100%";
      webview.style.transform = "";
      webview.style.backgroundColor = "#0d0d0d";
      webview.setAttribute("partition", BROWSER_WEBVIEW_PARTITION);
      webview.setAttribute("webpreferences", "contextIsolation=yes,nodeIntegration=no,sandbox=yes");

      webview.setAttribute("allowpopups", "true");

      webview.dataset.rendererGeneration = String(browserRendererGeneration);
      browserWebviewWebContentsIdRef.current = null;
      browserWebviewRef.current = webview;
    }
    if (webview.parentElement !== stage) {
      stage.append(webview);
    }
    applyBrowserWebviewPresentation(stage, {
      floating: isFloatingMode,
      slotWidth: host.clientWidth,
      slotHeight: host.clientHeight,
    });

    const initialUrl = activeTabInitialUrlRef.current;
    const shouldLoadInitialUrl = browserWebviewTabIdRef.current !== activeTabId;
    if (shouldLoadInitialUrl) {
      browserWebviewTabIdRef.current = activeTabId;
      browserWebviewAttachKeyRef.current = null;
      webview.dataset.tabId = activeTabId;
    }

    let cancelled = false;
    let attachRetryTimer: number | null = null;
    let attachRetryDelayMs = 25;

    const scheduleAttachRetry = () => {
      if (cancelled || attachRetryTimer !== null) {
        return;
      }
      attachRetryTimer = window.setTimeout(() => {
        attachRetryTimer = null;
        attachVisibleWebview();
      }, attachRetryDelayMs);
      attachRetryDelayMs = Math.min(attachRetryDelayMs * 2, 500);
    };

    let attachHandoffInFlight = false;
    const attachVisibleWebviewNow = () => {
      if (cancelled) {
        return;
      }
      if (attachRetryTimer !== null) {
        window.clearTimeout(attachRetryTimer);
        attachRetryTimer = null;
      }

      let webContentsId: number | undefined;
      try {
        webContentsId = webview.getWebContentsId?.();
      } catch {
        scheduleAttachRetry();
        return;
      }
      if (!webContentsId || webContentsId <= 0) {
        scheduleAttachRetry();
        return;
      }
      if (browserWebviewRef.current === webview) {
        browserWebviewWebContentsIdRef.current = webContentsId;
      }

      const attachKey = `${browserRendererGeneration}:${activeTabId}:${webContentsId}`;
      if (browserWebviewAttachKeyRef.current === attachKey) {
        return;
      }
      // A previous layout-effect generation may still be completing. Serialize physical guest adoption so
      // an older response can never overwrite the currently visible tab binding.
      if (browserWebviewAttachInFlightKeyRef.current !== null) {
        scheduleAttachRetry();
        return;
      }
      browserWebviewAttachInFlightKeyRef.current = attachKey;

      browserWebviewAttachKeyRef.current = attachKey;
      const finishAttachment = (state: ThreadBrowserState | null) => {
        if (browserWebviewAttachInFlightKeyRef.current === attachKey) {
          browserWebviewAttachInFlightKeyRef.current = null;
        }
        if (!state) {
          if (browserWebviewAttachKeyRef.current === attachKey) {
            browserWebviewAttachKeyRef.current = null;
          }
          if (
            !cancelled &&
            browserWebviewRef.current === webview &&
            browserWebviewTabIdRef.current === activeTabId
          ) {
            scheduleAttachRetry();
          }
          return;
        }
        // A tab switch can supersede this request while IPC is in flight. Main processes invokes in order,
        // and the current effect will bind the new tab next; never let the stale completion rewrite its
        // renderer lease.
        if (
          browserWebviewRef.current === webview &&
          browserWebviewTabIdRef.current === activeTabId
        ) {
          browserWebviewAttachKeyRef.current = attachKey;
          upsertThreadState(state);
        }
      };
      void api.browser
        .attachWebview({
          threadId,
          tabId: activeTabId,
          webContentsId,
        })
        .then(finishAttachment, () => finishAttachment(null));
    };
    const attachVisibleWebview = () => {
      if (cancelled || attachHandoffInFlight) {
        return;
      }
      attachHandoffInFlight = true;
      void browserPanelRendererHandoff.waitForDetach(threadId).then(() => {
        attachHandoffInFlight = false;
        attachVisibleWebviewNow();
      });
    };

    const handleRendererLoss = createBrowserRendererLossHandler({
      renderer: webview,
      rendererGeneration: browserRendererGeneration,
      tabId: activeTabId,
      isCurrent: (candidate) =>
        browserWebviewRef.current === candidate && browserWebviewTabIdRef.current === activeTabId,
      detach: detachRendererBrowserWebview,
      recover: ({ generation }) => {
        setBrowserRendererGeneration((current) => Math.max(current + 1, generation));
      },
    });

    webview.addEventListener("dom-ready", attachVisibleWebview);
    webview.addEventListener("did-start-loading", attachVisibleWebview);
    webview.addEventListener("render-process-gone", handleRendererLoss);
    webview.addEventListener("destroyed", handleRendererLoss);
    if (shouldLoadInitialUrl) {
      webview.setAttribute(
        "src",
        browserWebviewInitialUrl(initialUrl.length > 0 ? initialUrl : BROWSER_BLANK_URL),
      );
    }
    attachVisibleWebview();

    return () => {
      cancelled = true;
      if (attachRetryTimer !== null) {
        window.clearTimeout(attachRetryTimer);
      }
      webview.removeEventListener("dom-ready", attachVisibleWebview);
      webview.removeEventListener("did-start-loading", attachVisibleWebview);
      webview.removeEventListener("render-process-gone", handleRendererLoss);
      webview.removeEventListener("destroyed", handleRendererLoss);
    };
  }, [
    activeTabId,
    api,
    browserRendererGeneration,
    detachRendererBrowserWebview,
    isLiveRuntime,
    isFloatingMode,
    showLocalServersHome,
    threadId,
    upsertThreadState,
    usesNativeRuntime,
    rendererHasPopup,
    workspaceReady,
    browserWebviewStageRef,
    browserViewportRef,
    browserWebviewRef,
    browserWebviewWebContentsIdRef,
    activeTabInitialUrlRef,
    browserWebviewTabIdRef,
    browserWebviewAttachKeyRef,
    browserWebviewAttachInFlightKeyRef,
    setBrowserRendererGeneration,
  ]);

  useLayoutEffect(() => {
    return () => {
      detachRendererBrowserWebview();
    };
  }, [detachRendererBrowserWebview]);

  useEffect(() => {
    const liveTabIds = new Set(threadBrowserState?.tabs.map((tab) => tab.id) ?? []);
    for (const tabId of addressDraftsByTabIdRef.current.keys()) {
      if (!liveTabIds.has(tabId)) {
        addressDraftsByTabIdRef.current.delete(tabId);
        lastSyncedAddressByTabIdRef.current.delete(tabId);
      }
    }
  }, [threadBrowserState?.tabs, addressDraftsByTabIdRef, lastSyncedAddressByTabIdRef]);

  useEffect(() => {
    if (!isLiveRuntime || !isBrowserPerfLoggingEnabled()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      console.info(`[${GLADE_BROWSER_LABEL} panel perf]`, {
        threadId,
        ...perfCountersRef.current,
      });
    }, BROWSER_PERF_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLiveRuntime, threadId, perfCountersRef]);
}
