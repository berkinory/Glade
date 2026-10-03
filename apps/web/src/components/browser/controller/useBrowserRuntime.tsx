import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { BROWSER_BLANK_URL, isBlankBrowserTabUrl } from "@glade/shared/browser/browserSession";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectThreadBrowserState, useBrowserStateStore } from "~/browserStateStore";
import {
  applyBrowserWebviewPresentation,
  browserWebviewInitialUrl,
  createBrowserRendererLossHandler,
  isBrowserPanelBoundsHiddenKey,
  resolveBrowserRuntimePresentation,
  shouldOccludeBrowserWebview,
} from "~/components/BrowserPanel.logic";
import type { BrowserPanelMode } from "~/components/browser/BrowserPanelShell";
import { BROWSER_PANEL_BOUNDS_SYNC_EVENT } from "~/lib/browserPanelBoundsSync";
import { readDesktopZoomFactor, subscribeDesktopZoomFactor } from "~/lib/desktopZoom";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { NATIVE_SURFACE_OCCLUSION_SYNC_EVENT } from "~/lib/nativeSurfaceOcclusion";
import { readNativeApi } from "~/nativeApi";
import { runBrowserOperation } from "./browserActions";
import {
  BROWSER_BOUNDS_SYNC_BURST_FRAMES,
  BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET,
  BROWSER_PERF_SAMPLE_INTERVAL_MS,
  BROWSER_WEBVIEW_PARTITION,
  BrowserViewportPerfCounters,
  BrowserWebviewElement,
  GLADE_BROWSER_LABEL,
  VIEWPORT_TRANSITION_PROPERTIES,
  browserPanelHideScheduler,
  browserPanelRendererHandoff,
  hasNativeBrowserObscuringOverlay,
  ignoreBrowserBoundsSyncError,
  ignoreBrowserWebviewDetachError,
  isBrowserPerfLoggingEnabled,
  isNativeBrowserTransitionSignalTarget,
  setBrowserWebviewOverlayOcclusion,
} from "./browserPanelSupport";
export function useBrowserRuntime({
  threadId,
  mode,
  isVisible,
  runtimeMode: runtimeModeProp,
  browserActionsMenuOpen,
  setLocalError,
}: {
  threadId: ThreadId;
  mode: BrowserPanelMode;
  isVisible: boolean;
  runtimeMode: DockPaneRuntimeMode | undefined;
  browserActionsMenuOpen: boolean;
  setLocalError: (error: string | null) => void;
}) {
  const runtimeMode = runtimeModeProp ?? "live";
  const isFloatingMode = mode === "floating";
  const api = readNativeApi();
  const isLiveRuntime = runtimeMode === "live";
  const threadBrowserState = useBrowserStateStore(selectThreadBrowserState(threadId));
  const upsertThreadState = useBrowserStateStore((store) => store.upsertThreadState);
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const browserWebviewRef = useRef<BrowserWebviewElement | null>(null);
  const browserWebviewStageRef = useRef<HTMLDivElement | null>(null);
  const browserWebviewTabIdRef = useRef<string | null>(null);
  const browserWebviewWebContentsIdRef = useRef<number | null>(null);
  const detachedBrowserWebviewsRef = useRef(new WeakSet<BrowserWebviewElement>());
  const browserWebviewAttachKeyRef = useRef<string | null>(null);
  const browserWebviewAttachInFlightKeyRef = useRef<string | null>(null);
  const activeTabInitialUrlRef = useRef(BROWSER_BLANK_URL);
  const lastSentBoundsRef = useRef<string | null>(null);
  const lastMeasuredBoundsKeyRef = useRef<string | null>(null);
  const lastOverlayObscuredRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const boundsBurstFrameRef = useRef<number | null>(null);
  const burstFramesRemainingRef = useRef(0);
  const burstStableFramesRef = useRef(0);
  const perfCountersRef = useRef<BrowserViewportPerfCounters>({
    syncAttempts: 0,
    syncSkips: 0,
    syncSends: 0,
    resizeSchedules: 0,
    resizeScheduleSkips: 0,
    burstStarts: 0,
    burstExtensions: 0,
    burstFrames: 0,
    transitionSignals: 0,
    ignoredTransitionSignals: 0,
  });
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [browserRendererGeneration, setBrowserRendererGeneration] = useState(0);
  const [previewFrame, setPreviewFrame] = useState<{ tabId: string; src: string } | null>(null);
  const activeTab =
    threadBrowserState?.tabs.find((tab) => tab.id === threadBrowserState.activeTabId) ??
    threadBrowserState?.tabs[0] ??
    null;
  const activeTabId = activeTab?.id ?? null;
  const usesNativeRuntime = activeTab?.runtimeSurface === "native";
  const rendererHasPopup =
    threadBrowserState?.tabs.some(
      (tab) =>
        Boolean(tab.openerTabId) && tab.openerTabId === browserWebviewRef.current?.dataset.tabId,
    ) ?? false;
  activeTabInitialUrlRef.current =
    activeTab?.lastCommittedUrl ?? activeTab?.url ?? BROWSER_BLANK_URL;
  const activeTabIsBlank = isBlankBrowserTabUrl(activeTab);
  const showLocalServersHome = isLiveRuntime && workspaceReady && (!activeTab || activeTabIsBlank);
  const browserPageError = threadBrowserState?.lastError ?? null;
  const runBrowserAction = useCallback(
    <T,>(action: () => Promise<T>) => runBrowserOperation(action, setLocalError),
    [setLocalError],
  );
  const detachRendererBrowserWebview = useCallback(
    (expectedWebview?: BrowserWebviewElement) => {
      const webview = browserWebviewRef.current;
      if (
        !webview ||
        (expectedWebview !== undefined && webview !== expectedWebview) ||
        detachedBrowserWebviewsRef.current.has(webview)
      ) {
        return;
      }
      detachedBrowserWebviewsRef.current.add(webview);

      const tabId = browserWebviewTabIdRef.current;

      if (api && isLiveRuntime && tabId) {
        let webContentsId = browserWebviewWebContentsIdRef.current ?? undefined;
        try {
          webContentsId ??= webview.getWebContentsId?.();
        } catch {}
        if (webContentsId && webContentsId > 0) {
          try {
            const detachPromise = api.browser.detachWebview({ threadId, tabId, webContentsId });
            browserPanelRendererHandoff.trackDetach(threadId, detachPromise);
            void detachPromise.catch(ignoreBrowserWebviewDetachError);
          } catch {
            ignoreBrowserWebviewDetachError();
          }
        }
      }

      try {
        webview.remove();
      } catch {
        ignoreBrowserWebviewDetachError();
      } finally {
        if (browserWebviewRef.current === webview) {
          browserWebviewRef.current = null;
          browserWebviewTabIdRef.current = null;
          browserWebviewWebContentsIdRef.current = null;
          browserWebviewAttachKeyRef.current = null;
          browserWebviewAttachInFlightKeyRef.current = null;
        }
        const stage = browserWebviewStageRef.current;
        if (stage && stage.childElementCount === 0) {
          stage.remove();
          browserWebviewStageRef.current = null;
        }
      }
    },
    [
      api,
      isLiveRuntime,
      threadId,
      browserWebviewRef,
      detachedBrowserWebviewsRef,
      browserWebviewTabIdRef,
      browserWebviewWebContentsIdRef,
      browserWebviewAttachKeyRef,
      browserWebviewAttachInFlightKeyRef,
      browserWebviewStageRef,
    ],
  );
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
  useLayoutEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    const element = browserViewportRef.current;
    if (!element) {
      return;
    }

    const syncBounds = () => {
      perfCountersRef.current.syncAttempts += 1;
      // While the local-servers home is up, force the browser surface hidden instead of trusting the
      // obscuring-overlay heuristic. The native/inline webview otherwise paints about:blank white over
      // our dark DOM home — the "always white" empty state.
      const obscuredByOverlay =
        !isVisible ||
        ((!isFloatingMode || usesNativeRuntime) &&
          (browserPageError !== null ||
            shouldOccludeBrowserWebview({
              showLocalServersHome,
              browserActionsMenuOpen,
              hasObscuringOverlay: hasNativeBrowserObscuringOverlay(element),
            })));
      lastOverlayObscuredRef.current = obscuredByOverlay;
      setBrowserWebviewOverlayOcclusion(browserWebviewRef.current, obscuredByOverlay);
      const webview = browserWebviewRef.current;
      const stage = browserWebviewStageRef.current;
      if (stage) {
        applyBrowserWebviewPresentation(stage, {
          floating: isFloatingMode,
          slotWidth: element.clientWidth,
          slotHeight: element.clientHeight,
        });
      } else if (webview) {
        applyBrowserWebviewPresentation(webview, {
          floating: isFloatingMode,
          slotWidth: element.clientWidth,
          slotHeight: element.clientHeight,
        });
      }
      const rect = element.getBoundingClientRect();
      const presentation = resolveBrowserRuntimePresentation({
        native: usesNativeRuntime,
        floating: isFloatingMode,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        desktopZoom: readDesktopZoomFactor(),
      });
      const bounds =
        obscuredByOverlay || rect.width <= 0 || rect.height <= 0 ? null : presentation.bounds;
      const { surface, pageZoomFactor } = presentation;
      const nextKey = bounds
        ? `${surface}:${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}:zoom-${pageZoomFactor}:preview-${isFloatingMode}`
        : `${surface}:hidden:zoom-${pageZoomFactor}:preview-${isFloatingMode}`;
      lastMeasuredBoundsKeyRef.current = nextKey;
      if (lastSentBoundsRef.current === nextKey) {
        perfCountersRef.current.syncSkips += 1;
        return;
      }
      lastSentBoundsRef.current = nextKey;
      perfCountersRef.current.syncSends += 1;
      void api.browser
        .setPanelBounds({
          threadId,
          bounds,
          surface,
          pageZoomFactor,
          occluded: obscuredByOverlay,
          preview: isFloatingMode,
        })
        .catch(ignoreBrowserBoundsSyncError);
    };

    const syncBoundsBurst = (frames = BROWSER_BOUNDS_SYNC_BURST_FRAMES) => {
      if (boundsBurstFrameRef.current !== null) {
        perfCountersRef.current.burstExtensions += 1;
        burstFramesRemainingRef.current = Math.max(burstFramesRemainingRef.current, frames);
        burstStableFramesRef.current = 0;
        return;
      }

      perfCountersRef.current.burstStarts += 1;
      burstFramesRemainingRef.current = frames;
      burstStableFramesRef.current = 0;
      const tick = () => {
        perfCountersRef.current.burstFrames += 1;
        const previousMeasuredKey = lastMeasuredBoundsKeyRef.current;
        syncBounds();
        const measuredHidden = lastMeasuredBoundsKeyRef.current
          ? isBrowserPanelBoundsHiddenKey(lastMeasuredBoundsKeyRef.current)
          : false;
        if (!measuredHidden && lastMeasuredBoundsKeyRef.current === previousMeasuredKey) {
          burstStableFramesRef.current += 1;
        } else {
          burstStableFramesRef.current = 0;
        }
        burstFramesRemainingRef.current -= 1;
        if (
          burstFramesRemainingRef.current > 0 &&
          burstStableFramesRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET
        ) {
          boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        boundsBurstFrameRef.current = null;
        burstFramesRemainingRef.current = 0;
        burstStableFramesRef.current = 0;
      };

      boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
    };

    const scheduleSyncBounds = () => {
      perfCountersRef.current.resizeSchedules += 1;
      if (resizeFrameRef.current !== null) {
        perfCountersRef.current.resizeScheduleSkips += 1;
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        syncBounds();
      });
    };

    const handleTransitionBounds = (event: TransitionEvent) => {
      if (!isNativeBrowserTransitionSignalTarget(event.target, element)) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      if (
        event.propertyName.length > 0 &&
        !VIEWPORT_TRANSITION_PROPERTIES.has(event.propertyName)
      ) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      perfCountersRef.current.transitionSignals += 1;
      scheduleSyncBounds();
      if (event.type === "transitionrun") {
        syncBoundsBurst();
      }
    };

    syncBounds();
    syncBoundsBurst();
    const observer = new ResizeObserver(() => {
      scheduleSyncBounds();
    });
    observer.observe(element);
    // A zoom change moves the slot on the DIP grid. It usually reflows the panel too (so the observer
    // above fires), but a slot with a fixed CSS px size keeps its measured rect and would otherwise
    // strand the native view at the old scale.
    const unsubscribeZoom = subscribeDesktopZoomFactor(scheduleSyncBounds);
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener(BROWSER_PANEL_BOUNDS_SYNC_EVENT, scheduleSyncBounds);
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_SYNC_EVENT, scheduleSyncBounds);
    document.addEventListener("transitionrun", handleTransitionBounds, true);
    document.addEventListener("transitionend", handleTransitionBounds, true);
    document.addEventListener("transitioncancel", handleTransitionBounds, true);

    const clearWebviewOcclusion = () =>
      setBrowserWebviewOverlayOcclusion(browserWebviewRef.current, false);
    return () => {
      clearWebviewOcclusion();
      observer.disconnect();
      unsubscribeZoom();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener(BROWSER_PANEL_BOUNDS_SYNC_EVENT, scheduleSyncBounds);
      window.removeEventListener(NATIVE_SURFACE_OCCLUSION_SYNC_EVENT, scheduleSyncBounds);
      document.removeEventListener("transitionrun", handleTransitionBounds, true);
      document.removeEventListener("transitionend", handleTransitionBounds, true);
      document.removeEventListener("transitioncancel", handleTransitionBounds, true);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (boundsBurstFrameRef.current !== null) {
        cancelAnimationFrame(boundsBurstFrameRef.current);
        boundsBurstFrameRef.current = null;
      }
      burstFramesRemainingRef.current = 0;
      burstStableFramesRef.current = 0;
    };
  }, [
    isVisible,
    api,
    browserActionsMenuOpen,
    browserPageError,
    isLiveRuntime,
    isFloatingMode,
    showLocalServersHome,
    threadId,
    usesNativeRuntime,
    browserViewportRef,
    perfCountersRef,
    lastOverlayObscuredRef,
    browserWebviewRef,
    browserWebviewStageRef,
    lastMeasuredBoundsKeyRef,
    lastSentBoundsRef,
    boundsBurstFrameRef,
    burstFramesRemainingRef,
    burstStableFramesRef,
    resizeFrameRef,
  ]);
  useEffect(() => {
    if (
      !api ||
      !isLiveRuntime ||
      !workspaceReady ||
      !isFloatingMode ||
      !usesNativeRuntime ||
      !activeTabId
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = async () => {
      try {
        if (!document.hidden) {
          const src = await api.browser.capturePreview({ threadId, tabId: activeTabId });
          if (!cancelled && src) setPreviewFrame({ tabId: activeTabId, src });
        }
      } catch {
      } finally {
        if (!cancelled)
          timer = setTimeout(() => {
            void capture();
          }, 500);
      }
    };
    void capture();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    api,
    isLiveRuntime,
    workspaceReady,
    isFloatingMode,
    usesNativeRuntime,
    activeTabId,
    threadId,
    setPreviewFrame,
  ]);
  return { browserViewportRef, workspaceReady, previewFrame };
}
