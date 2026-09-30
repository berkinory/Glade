import { BROWSER_BLANK_URL, isBlankBrowserTabUrl } from "@glade/shared/browser/browserSession";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  selectThreadBrowserHistory,
  selectThreadBrowserState,
  useBrowserStateStore,
} from "~/browserStateStore";
import { useBrowserAnnotations } from "~/components/browser/useBrowserAnnotations";
import {
  buildBrowserAddressSuggestions,
  resolveBrowserChromeStatus,
} from "~/components/BrowserPanel.logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { serverLocalServersQueryOptions } from "~/lib/serverReactQuery";
import { readNativeApi } from "~/nativeApi";
import {
  BrowserPanelProps,
  BrowserViewportPerfCounters,
  BrowserWebviewElement,
  EMPTY_BROWSER_ANNOTATIONS,
  browserPanelRendererHandoff,
  formatBrowserActionError,
  ignoreBrowserWebviewDetachError,
} from "./browserPanelSupport";

export function useBrowserStateController(props: BrowserPanelProps) {
  const { mode, threadId, runtimeMode: runtimeModeProp, onRequestLive }: BrowserPanelProps = props;

  const runtimeMode = runtimeModeProp ?? "live";

  const isFloatingMode = mode === "floating";

  const api = readNativeApi();

  const isLiveRuntime = runtimeMode === "live";

  const threadBrowserState = useBrowserStateStore(selectThreadBrowserState(threadId));

  const recentHistory = useBrowserStateStore(selectThreadBrowserHistory(threadId));

  const upsertThreadState = useBrowserStateStore((store) => store.upsertThreadState);

  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);

  const addBrowserAnnotation = useComposerDraftStore((store) => store.addBrowserAnnotation);

  const browserAnnotations = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.browserAnnotations ?? EMPTY_BROWSER_ANNOTATIONS,
  );

  const composerDraftImageCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.images.length ?? 0,
  );

  const composerDraftFileCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.files.length ?? 0,
  );

  const composerDraftAssistantSelectionCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.assistantSelections.length ?? 0,
  );

  const addressInputRef = useRef<HTMLInputElement>(null);

  const browserViewportRef = useRef<HTMLDivElement>(null);

  const browserWebviewRef = useRef<BrowserWebviewElement | null>(null);

  const browserWebviewStageRef = useRef<HTMLDivElement | null>(null);

  const browserWebviewTabIdRef = useRef<string | null>(null);

  const browserWebviewWebContentsIdRef = useRef<number | null>(null);

  const detachedBrowserWebviewsRef = useRef(new WeakSet<BrowserWebviewElement>());

  const browserWebviewAttachKeyRef = useRef<string | null>(null);

  const browserWebviewAttachInFlightKeyRef = useRef<string | null>(null);

  const activeTabInitialUrlRef = useRef(BROWSER_BLANK_URL);

  const copyScreenshotButtonRef = useRef<HTMLButtonElement>(null);

  const addressDraftsByTabIdRef = useRef(new Map<string, string>());

  const lastSyncedAddressByTabIdRef = useRef(new Map<string, string>());

  const previousActiveTabIdRef = useRef<string | null>(null);

  const lastSentBoundsRef = useRef<string | null>(null);

  const lastMeasuredBoundsKeyRef = useRef<string | null>(null);

  const lastOverlayObscuredRef = useRef(false);

  const isAddressEditingRef = useRef(false);

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

  const [addressValue, setAddressValue] = useState("");

  const [isAddressFocused, setIsAddressFocused] = useState(false);

  const [addressSuggestionsSuppressed, setAddressSuggestionsSuppressed] = useState(false);

  const [workspaceReady, setWorkspaceReady] = useState(false);

  const [localError, setLocalError] = useState<string | null>(null);

  const [browserRendererGeneration, setBrowserRendererGeneration] = useState(0);

  const [browserActionsMenuOpen, setBrowserActionsMenuOpen] = useState(false);

  const [previewFrame, setPreviewFrame] = useState<{ tabId: string; src: string } | null>(null);

  const runtimeReady = isLiveRuntime ? workspaceReady : true;

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

  const activeTabInitialUrl = activeTab?.lastCommittedUrl ?? activeTab?.url ?? BROWSER_BLANK_URL;

  activeTabInitialUrlRef.current = activeTabInitialUrl;

  const loading = activeTab?.isLoading ?? false;

  const activeTabIsBlank = isBlankBrowserTabUrl(activeTab);

  const showLocalServersHome = isLiveRuntime && workspaceReady && (!activeTab || activeTabIsBlank);

  const localServersQuery = useQuery(serverLocalServersQueryOptions(showLocalServersHome));

  const activeTabStatus = activeTab?.status ?? "suspended";

  const browserChromeStatus = resolveBrowserChromeStatus({
    localError,
    threadLastError: threadBrowserState?.lastError,
    activeTabStatus: showLocalServersHome ? "live" : activeTabStatus,
    hasActiveTab: activeTab !== null,
    workspaceReady: runtimeReady,
  });

  const browserPageError = threadBrowserState?.lastError ?? null;

  const browserAddressSuggestions = buildBrowserAddressSuggestions({
    query: addressValue,
    activeTabId: activeTab?.id ?? null,
    tabs: threadBrowserState?.tabs ?? [],
    recentHistory,
  });

  const showBrowserAddressSuggestions =
    isLiveRuntime &&
    isAddressFocused &&
    !addressSuggestionsSuppressed &&
    browserAddressSuggestions.length > 0 &&
    runtimeReady;

  const annotationMethods = api?.browser.annotations;

  const annotationController = useBrowserAnnotations({
    methods: annotationMethods,
    threadId,
    activeTabId,
    browserStateVersion: threadBrowserState?.version ?? 0,
    enabled:
      isElectron && isLiveRuntime && workspaceReady && activeTab !== null && !showLocalServersHome,
    annotations: browserAnnotations,
    addAnnotation: addBrowserAnnotation,
    onError: setLocalError,
  });

  const requestLiveRuntime = useCallback(() => {
    onRequestLive?.();
  }, [onRequestLive]);

  const ensureLiveRuntime = useCallback(() => {
    if (isLiveRuntime) {
      return true;
    }
    requestLiveRuntime();
    return false;
  }, [isLiveRuntime, requestLiveRuntime]);

  const runBrowserAction = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await action();
        setLocalError(null);
        return result;
      } catch (error) {
        setLocalError(formatBrowserActionError(error));
        return null;
      }
    },
    [setLocalError],
  );

  // Renderer-owned <webview>s are adopted by the desktop manager. Always detach before removing the
  // DOM node so main never keeps a stale webContents runtime.
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
  return {
    isFloatingMode,
    api,
    isLiveRuntime,
    threadBrowserState,
    upsertThreadState,
    addComposerDraftImage,
    composerDraftImageCount,
    composerDraftFileCount,
    composerDraftAssistantSelectionCount,
    addressInputRef,
    browserViewportRef,
    browserWebviewRef,
    browserWebviewStageRef,
    browserWebviewTabIdRef,
    browserWebviewWebContentsIdRef,
    browserWebviewAttachKeyRef,
    browserWebviewAttachInFlightKeyRef,
    activeTabInitialUrlRef,
    copyScreenshotButtonRef,
    addressDraftsByTabIdRef,
    lastSyncedAddressByTabIdRef,
    previousActiveTabIdRef,
    lastSentBoundsRef,
    lastMeasuredBoundsKeyRef,
    lastOverlayObscuredRef,
    isAddressEditingRef,
    resizeFrameRef,
    boundsBurstFrameRef,
    burstFramesRemainingRef,
    burstStableFramesRef,
    perfCountersRef,
    addressValue,
    setAddressValue,
    setIsAddressFocused,
    setAddressSuggestionsSuppressed,
    workspaceReady,
    setWorkspaceReady,
    setLocalError,
    browserRendererGeneration,
    setBrowserRendererGeneration,
    browserActionsMenuOpen,
    setBrowserActionsMenuOpen,
    previewFrame,
    setPreviewFrame,
    activeTab,
    activeTabId,
    usesNativeRuntime,
    rendererHasPopup,
    loading,
    showLocalServersHome,
    localServersQuery,
    browserChromeStatus,
    browserPageError,
    browserAddressSuggestions,
    showBrowserAddressSuggestions,
    annotationMethods,
    annotationController,
    requestLiveRuntime,
    ensureLiveRuntime,
    runBrowserAction,
    detachRendererBrowserWebview,
  } as const;
}
