import {
  BROWSER_CHROME_CONTROL_CLASS_NAME,
  BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
} from "~/components/BrowserPanel.logic";
import { BrowserTabStrip } from "~/components/BrowserTabStrip";
import { BrowserVaultButton } from "~/components/BrowserVault";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { DiffPanelLoadingState, DiffPanelShell } from "~/components/DiffPanelShell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { isElectron } from "~/env";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  BROWSER_ACTION_MENU_ITEM_CLASS_NAME,
  BROWSER_ACTION_MENU_PANEL_CLASS_NAME,
  BrowserActionMenuIcon,
  BrowserAnnotationButton,
  BrowserLocalServersHome,
  BrowserRuntimeError,
  BrowserRuntimePreview,
} from "./browserPanelSupport";
import type { BrowserController } from "./useBrowserController";
export function BrowserControllerSurface({ controller }: { controller: BrowserController }) {
  const { mode, threadId, onClosePanel } = controller.props;
  const {
    activeTab,
    ensureLiveRuntime,
    api,
    runBrowserAction,
    upsertThreadState,
    loading,
    addressInputRef,
    addressValue,
    isLiveRuntime,
    requestLiveRuntime,
    isAddressEditingRef,
    setAddressSuggestionsSuppressed,
    setAddressValue,
    addressDraftsByTabIdRef,
    setIsAddressFocused,
    showBrowserAddressSuggestions,
    browserAddressSuggestions,
    annotationController,
    workspaceReady,
    showLocalServersHome,
    annotationMethods,
    copyScreenshotButtonRef,
    browserActionsMenuOpen,
    setBrowserActionsMenuOpen,
    isFloatingMode,
    threadBrowserState,
    activeTabId,
    browserChromeStatus,
    browserViewportRef,
    browserPageError,
    usesNativeRuntime,
    previewFrame,
    localServersQuery,
  } = controller.state;
  const {
    onSubmitAddress,
    onChooseSuggestion,
    onCopyScreenshotToClipboard,
    copyActiveTabLink,
    onCreateTab,
    onCaptureScreenshot,
    onSelectTab,
    onCloseTab,
    onReloadActiveTab,
    onOpenLocalServer,
  } = controller.actions;

  const header = (
    <div
      className={cn("flex min-w-0 flex-1 items-center gap-2", mode === "floating" && "cursor-grab")}
      data-floating-browser-header={mode === "floating" ? "true" : undefined}
    >
      {}
      <div className="relative flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoBack}
            onClick={() => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              void runBrowserAction(() =>
                api.browser.goBack({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            <ArrowLeftIcon className="size-3.5" />
            <span className="sr-only">Go back</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoForward}
            onClick={() => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              void runBrowserAction(() =>
                api.browser.goForward({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            <ArrowRightIcon className="size-3.5" />
            <span className="sr-only">Go forward</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab}
            onClick={() => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              void runBrowserAction(() =>
                api.browser.reload({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            {loading ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            <span className="sr-only">Reload</span>
          </Button>
        </div>
        <form
          className="min-w-0 flex-1 [-webkit-app-region:no-drag]"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitAddress();
          }}
        >
          <Input
            ref={addressInputRef}
            value={addressValue}
            onChange={(event) => {
              if (!isLiveRuntime) {
                requestLiveRuntime();
              }
              const nextValue = event.target.value;
              isAddressEditingRef.current = true;
              setAddressSuggestionsSuppressed(false);
              setAddressValue(nextValue);
              if (activeTab) {
                addressDraftsByTabIdRef.current.set(activeTab.id, nextValue);
              }
            }}
            onFocus={() => {
              if (!isLiveRuntime) {
                requestLiveRuntime();
              }
              isAddressEditingRef.current = true;
              setIsAddressFocused(true);
            }}
            onBlur={() => {
              isAddressEditingRef.current = false;
              setIsAddressFocused(false);
              setAddressSuggestionsSuppressed(false);
            }}
            onMouseDown={() => {
              setAddressSuggestionsSuppressed(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                setAddressSuggestionsSuppressed(false);
              }
            }}
            placeholder="Search or enter a URL"
            className={cn(
              "min-w-0 [-webkit-app-region:no-drag]",
              BROWSER_CHROME_CONTROL_CLASS_NAME,
              BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
            )}
          />
        </form>
        {showBrowserAddressSuggestions ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-lg [-webkit-app-region:no-drag]">
            <div className="max-h-64 overflow-auto p-1">
              {browserAddressSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui leading-snug text-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChooseSuggestion(suggestion);
                  }}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-background/80">
                    {suggestion.kind === "navigate" ? (
                      <ExternalLinkIcon className="size-3 text-muted-foreground" />
                    ) : suggestion.faviconUrl ? (
                      <img alt="" src={suggestion.faviconUrl} className="size-3 rounded-[2px]" />
                    ) : (
                      <GlobeIcon className="size-3 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{suggestion.title}</span>
                    <span className="block truncate text-ui-sm text-muted-foreground">
                      {suggestion.detail}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <BrowserVaultButton />
        <BrowserAnnotationButton
          controller={annotationController}
          disabled={
            !isLiveRuntime ||
            !isElectron ||
            !workspaceReady ||
            !activeTab ||
            showLocalServersHome ||
            !annotationMethods
          }
        />
        <Button
          ref={copyScreenshotButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label="Copy screenshot"
          title="Copy screenshot"
          onClick={onCopyScreenshotToClipboard}
        >
          <CameraIcon className="size-3.5" />
          <span className="sr-only">Copy screenshot</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label="Copy link"
          title="Copy link"
          onClick={copyActiveTabLink}
        >
          <LinkIcon className="size-3.5" />
          <span className="sr-only">Copy link</span>
        </Button>
        <Menu modal={false} open={browserActionsMenuOpen} onOpenChange={setBrowserActionsMenuOpen}>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="Browser actions"
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup
            align="end"
            side="bottom"
            className={BROWSER_ACTION_MENU_PANEL_CLASS_NAME}
          >
            <MenuItem className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME} onClick={onCreateTab}>
              <BrowserActionMenuIcon icon={PlusIcon} />
              <span>New tab</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={onCaptureScreenshot}
            >
              <BrowserActionMenuIcon icon={CameraIcon} />
              <span>Capture screenshot</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={() => {
                if (!ensureLiveRuntime()) return;
                if (!api || !activeTab) return;
                void api.shell.openExternal(activeTab.url);
              }}
            >
              <BrowserActionMenuIcon icon={ExternalLinkIcon} />
              <span>Open externally</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME} onClick={onClosePanel}>
              <BrowserActionMenuIcon icon={XIcon} />
              <span>Close browser panel</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
    </div>
  );

  if (!api && isLiveRuntime) {
    return (
      <div className="contents" data-browser-panel="true">
        <DiffPanelShell mode={mode} header={isFloatingMode ? null : header}>
          <DiffPanelLoadingState label="Browser is unavailable." />
        </DiffPanelShell>
      </div>
    );
  }

  return (
    <div className="contents" data-browser-panel="true">
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
