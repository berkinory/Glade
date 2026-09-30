import { isBlankBrowserTabUrl } from "@glade/shared/browser/browserSession";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { selectThreadBrowserState, useBrowserStateStore } from "~/browserStateStore";
import { runBrowserCommand } from "~/components/browser/controller/browserActions";
import {
  BrowserHeader,
  type BrowserHeaderHandle,
} from "~/components/browser/controller/BrowserHeader";
import {
  BrowserPanelContext,
  useBrowserPanelScope,
} from "~/components/browser/controller/BrowserPanelContext";
import {
  BrowserLocalServersHome,
  BrowserRuntimeError,
  BrowserRuntimePreview,
  EMPTY_BROWSER_ANNOTATIONS,
  type BrowserPanelProps,
} from "~/components/browser/controller/browserPanelSupport";
import { useBrowserRuntime } from "~/components/browser/controller/useBrowserRuntime";
import { useBrowserAnnotations } from "~/components/browser/useBrowserAnnotations";
import { resolveBrowserChromeStatus } from "~/components/BrowserPanel.logic";
import { BrowserTabStrip } from "~/components/BrowserTabStrip";
import { DiffPanelLoadingState, DiffPanelShell } from "~/components/DiffPanelShell";
import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { serverLocalServersQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
export default function BrowserPanel(props: BrowserPanelProps) {
  return (
    <BrowserPanelContext value={props}>
      <BrowserPanelBody />
    </BrowserPanelContext>
  );
}
function BrowserPanelBody() {
  const {
    mode,
    threadId,
    runtimeMode = "live",
    onRequestLive,
    onClosePanel,
  } = useBrowserPanelScope();
  const api = readNativeApi(),
    isLiveRuntime = runtimeMode === "live",
    isFloatingMode = mode === "floating";
  const threadBrowserState = useBrowserStateStore(selectThreadBrowserState(threadId));
  const activeTab =
    threadBrowserState?.tabs.find((tab) => tab.id === threadBrowserState.activeTabId) ??
    threadBrowserState?.tabs[0] ??
    null;
  const activeTabId = activeTab?.id ?? null,
    usesNativeRuntime = activeTab?.runtimeSurface === "native";
  const [localError, setLocalError] = useState<string | null>(null),
    [browserActionsMenuOpen, setBrowserActionsMenuOpen] = useState(false);
  const { browserViewportRef, workspaceReady, previewFrame } = useBrowserRuntime({
    threadId,
    mode,
    runtimeMode,
    browserActionsMenuOpen,
    setLocalError,
  });
  const showLocalServersHome =
    isLiveRuntime && workspaceReady && (!activeTab || isBlankBrowserTabUrl(activeTab));
  const localServersQuery = useQuery(serverLocalServersQueryOptions(showLocalServersHome));
  const browserPageError = threadBrowserState?.lastError ?? null;
  const browserChromeStatus = resolveBrowserChromeStatus({
    localError,
    threadLastError: threadBrowserState?.lastError,
    activeTabStatus: showLocalServersHome ? "live" : (activeTab?.status ?? "suspended"),
    hasActiveTab: activeTab !== null,
    workspaceReady: isLiveRuntime ? workspaceReady : true,
  });
  const browserAnnotations = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.browserAnnotations ?? EMPTY_BROWSER_ANNOTATIONS,
  );
  const addBrowserAnnotation = useComposerDraftStore((store) => store.addBrowserAnnotation);
  const annotationController = useBrowserAnnotations({
    methods: api?.browser.annotations,
    threadId,
    activeTabId,
    browserStateVersion: threadBrowserState?.version ?? 0,
    enabled:
      isElectron && isLiveRuntime && workspaceReady && activeTab !== null && !showLocalServersHome,
    annotations: browserAnnotations,
    addAnnotation: addBrowserAnnotation,
    onError: setLocalError,
  });
  const headerRef = useRef<BrowserHeaderHandle | null>(null);
  const header = (
    <BrowserHeader
      ref={headerRef}
      workspaceReady={workspaceReady}
      setLocalError={setLocalError}
      browserActionsMenuOpen={browserActionsMenuOpen}
      setBrowserActionsMenuOpen={setBrowserActionsMenuOpen}
      annotationController={annotationController}
    />
  );
  const ensureLiveRuntime = useCallback(() => {
    if (isLiveRuntime) return true;
    onRequestLive?.();
    return false;
  }, [isLiveRuntime, onRequestLive]);
  const onSelectTab = (tabId: string) => {
    if (ensureLiveRuntime())
      void runBrowserCommand(threadId, { kind: "select", tabId }, setLocalError);
  };
  const onCloseTab = (tabId: string) => {
    if (ensureLiveRuntime())
      void runBrowserCommand(threadId, { kind: "close", tabId }, setLocalError).then((state) => {
        if (state && !state.open && state.tabs.length === 0) onClosePanel();
      });
  };
  const onCreateTab = () => headerRef.current?.createTab();
  const onOpenLocalServer = (url: string, tabId: string | null) =>
    headerRef.current?.navigate(url, tabId);
  const onReloadActiveTab = () => {
    if (ensureLiveRuntime() && activeTab)
      void runBrowserCommand(threadId, { kind: "reload", tabId: activeTab.id }, setLocalError);
  };
  if (!api && isLiveRuntime) {
    return (
      <div className="contents" data-browser-panel="true">
        {isFloatingMode ? header : null}
        <DiffPanelShell mode={mode} header={isFloatingMode ? null : header}>
          <DiffPanelLoadingState label="Browser is unavailable." />
        </DiffPanelShell>
      </div>
    );
  }
  return (
    <div className="contents" data-browser-panel="true">
      {isFloatingMode ? header : null}
      <DiffPanelShell mode={mode} header={isFloatingMode ? null : header}>
        <div className="flex min-h-0 flex-1 flex-col">
          {!isFloatingMode ? (
            <BrowserTabStrip
              tabs={threadBrowserState?.tabs ?? []}
              activeTabId={activeTabId}
              status={browserChromeStatus}
              dragRegion={isElectron && mode !== "sheet"}
              onSelectTab={(tabId) => void onSelectTab(tabId)}
              onCloseTab={onCloseTab}
              onCreateTab={onCreateTab}
            />
          ) : null}
          <div className="relative min-h-0 flex-1 bg-transparent">
            {!isLiveRuntime ? (
              <BrowserRuntimePreview
                title={activeTab?.title || "Browser is sleeping"}
                detail={activeTab?.lastCommittedUrl ?? activeTab?.url ?? "Restoring cached browser"}
              />
            ) : !workspaceReady ? (
              <div className="absolute inset-0 z-10">
                <DiffPanelLoadingState label="Starting browser..." />
              </div>
            ) : null}
            {isLiveRuntime ? (
              <div
                ref={browserViewportRef}
                data-floating-browser-viewport={isFloatingMode ? "true" : undefined}
                className={cn(
                  "absolute overflow-hidden",
                  isFloatingMode ? "bg-transparent" : "bg-[#0d0d0d]",
                  isFloatingMode && "rounded-[10px] [clip-path:inset(0_round_10px)]",
                  "inset-0",
                )}
              />
            ) : null}
            {isLiveRuntime && browserPageError ? (
              <BrowserRuntimeError message={browserPageError} onReload={onReloadActiveTab} />
            ) : null}
            {isFloatingMode && usesNativeRuntime && previewFrame?.tabId === activeTabId ? (
              <img
                src={previewFrame.src}
                alt="Browser preview"
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
              />
            ) : null}
            {showLocalServersHome ? (
              <BrowserLocalServersHome
                activeTabId={activeTab?.id ?? null}
                loading={localServersQuery.isLoading || localServersQuery.isFetching}
                onNavigate={onOpenLocalServer}
                onRefresh={() => void localServersQuery.refetch()}
                servers={localServersQuery.data?.servers ?? []}
              />
            ) : null}
          </div>
        </div>
      </DiffPanelShell>
    </div>
  );
}
