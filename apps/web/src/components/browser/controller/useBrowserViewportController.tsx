import { useEffect, useLayoutEffect } from "react";
import {
  applyBrowserWebviewPresentation,
  isBrowserPanelBoundsHiddenKey,
  resolveBrowserRuntimePresentation,
  shouldOccludeBrowserWebview,
} from "~/components/BrowserPanel.logic";
import { BROWSER_PANEL_BOUNDS_SYNC_EVENT } from "~/lib/browserPanelBoundsSync";
import { readDesktopZoomFactor, subscribeDesktopZoomFactor } from "~/lib/desktopZoom";
import { NATIVE_SURFACE_OCCLUSION_SYNC_EVENT } from "~/lib/nativeSurfaceOcclusion";
import {
  BROWSER_BOUNDS_SYNC_BURST_FRAMES,
  BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET,
  BrowserPanelProps,
  VIEWPORT_TRANSITION_PROPERTIES,
  hasNativeBrowserObscuringOverlay,
  ignoreBrowserBoundsSyncError,
  isNativeBrowserTransitionSignalTarget,
  setBrowserWebviewOverlayOcclusion,
} from "./browserPanelSupport";
import type { useBrowserStateController } from "./useBrowserStateController";
export function useBrowserViewportController({
  state,
  props,
}: {
  state: ReturnType<typeof useBrowserStateController>;
  props: BrowserPanelProps;
}) {
  const {
    api,
    isLiveRuntime,
    browserViewportRef,
    perfCountersRef,
    isFloatingMode,
    usesNativeRuntime,
    browserPageError,
    showLocalServersHome,
    browserActionsMenuOpen,
    lastOverlayObscuredRef,
    browserWebviewRef,
    browserWebviewStageRef,
    lastMeasuredBoundsKeyRef,
    lastSentBoundsRef,
    boundsBurstFrameRef,
    burstFramesRemainingRef,
    burstStableFramesRef,
    resizeFrameRef,
    workspaceReady,
    activeTabId,
    setPreviewFrame,
  } = state;
  const { threadId } = props;

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
        (!isFloatingMode || usesNativeRuntime) &&
        (browserPageError !== null ||
          shouldOccludeBrowserWebview({
            showLocalServersHome,
            browserActionsMenuOpen,
            hasObscuringOverlay: hasNativeBrowserObscuringOverlay(element),
          }));
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
}
