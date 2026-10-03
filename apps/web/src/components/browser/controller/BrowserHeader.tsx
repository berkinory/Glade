import { CentralIcon } from "~/lib/central-icons";
import { isBlankBrowserTabUrl } from "@glade/shared/browser/browserSession";
import {
  BROWSER_COPY_LINK_TOAST_TITLE,
  isBrowserCopyLinkChord,
} from "@glade/shared/browser/browserShortcuts";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  selectThreadBrowserHistory,
  selectThreadBrowserState,
  useBrowserStateStore,
} from "~/browserStateStore";
import type { BrowserAnnotationsController } from "~/components/browser/useBrowserAnnotations";
import {
  BROWSER_CHROME_CONTROL_CLASS_NAME,
  BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  type BrowserAddressSuggestion,
} from "~/components/BrowserPanel.logic";
import { BrowserVaultButton } from "~/components/BrowserVault";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "~/lib/icons";
import { cn, isMacNavigatorPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
  captureBrowserScreenshot,
  copyBrowserLink,
  copyBrowserScreenshot,
  runBrowserCommand,
} from "./browserActions";
import { useBrowserPanelScope } from "./BrowserPanelContext";
import {
  BROWSER_ACTION_MENU_ITEM_CLASS_NAME,
  BROWSER_ACTION_MENU_PANEL_CLASS_NAME,
  BrowserActionMenuIcon,
  BrowserAnnotationButton,
} from "./browserPanelSupport";
export interface BrowserHeaderHandle {
  createTab: () => void;
  navigate: (url: string, tabId: string | null) => void;
}
export function BrowserHeader({
  ref,
  workspaceReady,
  setLocalError,
  browserActionsMenuOpen,
  setBrowserActionsMenuOpen,
  annotationController,
}: {
  ref: RefObject<BrowserHeaderHandle | null>;
  workspaceReady: boolean;
  setLocalError: (error: string | null) => void;
  browserActionsMenuOpen: boolean;
  setBrowserActionsMenuOpen: (open: boolean) => void;
  annotationController: BrowserAnnotationsController;
}) {
  const {
    mode,
    threadId,
    runtimeMode: runtimeModeProp,
    onRequestLive,
    onClosePanel,
  } = useBrowserPanelScope();
  const runtimeMode = runtimeModeProp ?? "live";
  const api = readNativeApi();
  const isLiveRuntime = runtimeMode === "live";
  const threadBrowserState = useBrowserStateStore(selectThreadBrowserState(threadId));
  const recentHistory = useBrowserStateStore(selectThreadBrowserHistory(threadId));
  const addressInputRef = useRef<HTMLInputElement>(null);
  const copyScreenshotButtonRef = useRef<HTMLButtonElement>(null);
  const addressDraftsByTabIdRef = useRef(new Map<string, string>());
  const lastSyncedAddressByTabIdRef = useRef(new Map<string, string>());
  const previousActiveTabIdRef = useRef<string | null>(null);
  const isAddressEditingRef = useRef(false);
  const [addressValue, setAddressValue] = useState("");
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [addressSuggestionsSuppressed, setAddressSuggestionsSuppressed] = useState(false);
  const runtimeReady = isLiveRuntime ? workspaceReady : true;
  const activeTab =
    threadBrowserState?.tabs.find((tab) => tab.id === threadBrowserState.activeTabId) ??
    threadBrowserState?.tabs[0] ??
    null;
  const loading = activeTab?.isLoading ?? false;
  const activeTabIsBlank = isBlankBrowserTabUrl(activeTab);
  const showLocalServersHome = isLiveRuntime && workspaceReady && (!activeTab || activeTabIsBlank);
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
  useEffect(() => {
    const liveTabIds = new Set(threadBrowserState?.tabs.map((tab) => tab.id) ?? []);
    for (const tabId of addressDraftsByTabIdRef.current.keys()) {
      if (!liveTabIds.has(tabId)) {
        addressDraftsByTabIdRef.current.delete(tabId);
        lastSyncedAddressByTabIdRef.current.delete(tabId);
      }
    }
  }, [threadBrowserState?.tabs, addressDraftsByTabIdRef, lastSyncedAddressByTabIdRef]);
  const requestLiveRuntime = useCallback(() => onRequestLive?.(), [onRequestLive]);
  const ensureLiveRuntime = useCallback(() => {
    if (isLiveRuntime) return true;
    requestLiveRuntime();
    return false;
  }, [isLiveRuntime, requestLiveRuntime]);
  const updateAddress = (value: string, tabId: string | null) => {
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
    setAddressValue(value);
    if (tabId) addressDraftsByTabIdRef.current.set(tabId, value);
  };
  const onSubmitAddress = () => {
    if (!ensureLiveRuntime() || !api || !activeTab) return;
    const url = normalizeBrowserAddressInput(addressValue);
    updateAddress(url, activeTab.id);
    void runBrowserCommand(threadId, { kind: "navigate", tabId: activeTab.id, url }, setLocalError);
  };
  const onChooseSuggestion = (suggestion: BrowserAddressSuggestion) => {
    if (!api || !ensureLiveRuntime()) return;
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
    setAddressValue(suggestion.url);
    if (suggestion.kind === "tab" && typeof suggestion.tabId === "string") {
      void runBrowserCommand(
        threadId,
        { kind: "select", tabId: suggestion.tabId },
        setLocalError,
      ).then(() => {
        window.requestAnimationFrame(() => {
          addressInputRef.current?.focus();
          addressInputRef.current?.select();
        });
      });
    } else {
      if (activeTab) addressDraftsByTabIdRef.current.set(activeTab.id, suggestion.url);
      void runBrowserCommand(
        threadId,
        { kind: "navigate", url: suggestion.url, ...(activeTab ? { tabId: activeTab.id } : {}) },
        setLocalError,
      );
    }
  };
  const onCreateTab = () => {
    if (!api) return;
    if (!isLiveRuntime) requestLiveRuntime();
    void runBrowserCommand(threadId, { kind: "new" }, setLocalError).then((state) => {
      if (!state) return;
      setAddressSuggestionsSuppressed(true);
      window.requestAnimationFrame(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      });
    });
  };
  const onCaptureScreenshot = () => {
    if (ensureLiveRuntime() && activeTab)
      void captureBrowserScreenshot(threadId, activeTab.id, setLocalError);
  };
  const onCopyScreenshotToClipboard = () => {
    if (ensureLiveRuntime() && activeTab)
      void copyBrowserScreenshot(
        threadId,
        activeTab.id,
        () => copyScreenshotButtonRef.current,
        setLocalError,
      );
  };
  const copyActiveTabLink = useCallback(() => {
    if (activeTab) void copyBrowserLink(threadId, activeTab.id, setLocalError);
  }, [activeTab, threadId, setLocalError]);
  useEffect(() => {
    if (!isLiveRuntime) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isBrowserCopyLinkChord(
          {
            meta: event.metaKey,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
            key: event.key,
          },
          isMacNavigatorPlatform(),
        )
      )
        return;
      event.preventDefault();
      copyActiveTabLink();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copyActiveTabLink, isLiveRuntime]);
  useEffect(() => {
    if (!api || !isLiveRuntime) return;
    return api.browser.onCopyLink((event) => {
      if (event.threadId === threadId)
        toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
    });
  }, [api, isLiveRuntime, threadId]);

  useImperativeHandle(ref, () => ({
    createTab: onCreateTab,
    navigate: (url, tabId) => {
      if (!api || !ensureLiveRuntime()) return;
      updateAddress(url, tabId);
      void runBrowserCommand(
        threadId,
        { kind: "navigate", url, ...(tabId ? { tabId } : {}) },
        setLocalError,
      );
    },
  }));
  if (mode === "floating") return null;
  const annotationMethods = api?.browser.annotations;
  return (
    <div className={"flex min-w-0 flex-1 items-center gap-2"}>
      <div className="relative flex min-w-0 flex-1 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoBack}
            onClick={() => {
              if (ensureLiveRuntime() && activeTab)
                void runBrowserCommand(
                  threadId,
                  { kind: "back", tabId: activeTab.id },
                  setLocalError,
                );
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
              if (ensureLiveRuntime() && activeTab)
                void runBrowserCommand(
                  threadId,
                  { kind: "forward", tabId: activeTab.id },
                  setLocalError,
                );
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
              if (ensureLiveRuntime() && activeTab)
                void runBrowserCommand(
                  threadId,
                  { kind: "reload", tabId: activeTab.id },
                  setLocalError,
                );
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
      <div className="flex shrink-0 items-center gap-1">
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
          <CentralIcon name="link" className="size-3.5" />
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
}
