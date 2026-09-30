import { type ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import { resolveCopyableBrowserTabUrl } from "@glade/shared/browser/browserSession";
import {
  BROWSER_COPY_LINK_TOAST_TITLE,
  isBrowserCopyLinkChord,
} from "@glade/shared/browser/browserShortcuts";
import { useCallback, useEffect } from "react";
import {
  normalizeBrowserAddressInput,
  type BrowserAddressSuggestion,
} from "~/components/BrowserPanel.logic";
import { anchoredToastManager, toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { prepareComposerImageFromBrowserScreenshot } from "~/lib/browserPromptContext";
import { isMacNavigatorPlatform } from "~/lib/utils";
import { BrowserPanelProps } from "./browserPanelSupport";
import type { useBrowserStateController } from "./useBrowserStateController";
export function useBrowserActionsController({
  state,
  props,
}: {
  state: ReturnType<typeof useBrowserStateController>;
  props: BrowserPanelProps;
}) {
  const {
    ensureLiveRuntime,
    api,
    activeTab,
    isAddressEditingRef,
    setIsAddressFocused,
    addressValue,
    addressDraftsByTabIdRef,
    setAddressValue,
    runBrowserAction,
    upsertThreadState,
    addressInputRef,
    isLiveRuntime,
    requestLiveRuntime,
    setAddressSuggestionsSuppressed,
    composerDraftImageCount,
    composerDraftFileCount,
    composerDraftAssistantSelectionCount,
    setLocalError,
    addComposerDraftImage,
    copyScreenshotButtonRef,
  } = state;
  const { threadId, onClosePanel } = props;

  const onSubmitAddress = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
    const normalizedAddress = normalizeBrowserAddressInput(addressValue);
    addressDraftsByTabIdRef.current.set(activeTab.id, normalizedAddress);
    setAddressValue(normalizedAddress);
    void runBrowserAction(() =>
      api.browser.navigate({
        threadId,
        tabId: activeTab.id,
        url: normalizedAddress,
      }),
    ).then((state) => {
      if (state) {
        upsertThreadState(state);
      }
    });
  }, [
    activeTab,
    addressValue,
    api,
    ensureLiveRuntime,
    runBrowserAction,
    threadId,
    upsertThreadState,
    isAddressEditingRef,
    setIsAddressFocused,
    addressDraftsByTabIdRef,
    setAddressValue,
  ]);

  const onReloadActiveTab = useCallback(() => {
    if (!ensureLiveRuntime() || !api || !activeTab) {
      return;
    }
    void runBrowserAction(() => api.browser.reload({ threadId, tabId: activeTab.id })).then(
      (state) => {
        if (state) {
          upsertThreadState(state);
        }
      },
    );
  }, [activeTab, api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState]);

  const onSelectTab = useCallback(
    (tabId: string): Promise<ThreadBrowserState | null> => {
      if (!ensureLiveRuntime() || !api) {
        return Promise.resolve(null);
      }
      return runBrowserAction(() => api.browser.selectTab({ threadId, tabId })).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
        return state;
      });
    },
    [api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState],
  );

  const onChooseSuggestion = useCallback(
    (suggestion: BrowserAddressSuggestion) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(suggestion.url);

      const tabId = suggestion.tabId;
      if (suggestion.kind === "tab" && typeof tabId === "string") {
        void onSelectTab(tabId).then(() => {
          window.requestAnimationFrame(() => {
            addressInputRef.current?.focus();
            addressInputRef.current?.select();
          });
        });
        return;
      }

      if (activeTab) {
        addressDraftsByTabIdRef.current.set(activeTab.id, suggestion.url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url: suggestion.url,
          ...(activeTab ? { tabId: activeTab.id } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [
      activeTab,
      api,
      ensureLiveRuntime,
      onSelectTab,
      runBrowserAction,
      threadId,
      upsertThreadState,
      isAddressEditingRef,
      setIsAddressFocused,
      setAddressValue,
      addressInputRef,
      addressDraftsByTabIdRef,
    ],
  );

  const onOpenLocalServer = useCallback(
    (url: string, tabId: string | null) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(url);
      if (tabId) {
        addressDraftsByTabIdRef.current.set(tabId, url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url,
          ...(tabId ? { tabId } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [
      api,
      ensureLiveRuntime,
      runBrowserAction,
      threadId,
      upsertThreadState,
      isAddressEditingRef,
      setIsAddressFocused,
      setAddressValue,
      addressDraftsByTabIdRef,
    ],
  );

  const onCreateTab = useCallback(() => {
    if (!api) {
      return;
    }
    // Creating a tab never needs a live renderer: main records it (suspended when this thread's panel
    // is not attached) and the next bounds sync shows it. Wake a preview pane instead of silently
    // dropping the action until the user clicks twice.
    if (!isLiveRuntime) {
      requestLiveRuntime();
    }
    void runBrowserAction(() => api.browser.newTab({ threadId, activate: true })).then((state) => {
      if (!state) {
        return;
      }
      upsertThreadState(state);
      setAddressSuggestionsSuppressed(true);
      window.requestAnimationFrame(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      });
    });
  }, [
    api,
    isLiveRuntime,
    requestLiveRuntime,
    runBrowserAction,
    threadId,
    upsertThreadState,
    setAddressSuggestionsSuppressed,
    addressInputRef,
  ]);

  const onCaptureScreenshot = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }

    const attachmentCount =
      composerDraftImageCount + composerDraftFileCount + composerDraftAssistantSelectionCount;
    if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setLocalError(
        `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
      );
      return;
    }

    void runBrowserAction(() =>
      api.browser.captureScreenshot({ threadId, tabId: activeTab.id }),
    ).then(async (screenshot) => {
      if (!screenshot) {
        return;
      }
      try {
        const inserted = addComposerDraftImage(
          threadId,
          await prepareComposerImageFromBrowserScreenshot(screenshot),
        );
        if (!inserted) {
          throw new Error(
            `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
          );
        }
        setLocalError(null);
      } catch (cause) {
        setLocalError(
          cause instanceof Error ? cause.message : "The browser screenshot could not be prepared.",
        );
      }
    });
  }, [
    activeTab,
    addComposerDraftImage,
    api,
    composerDraftAssistantSelectionCount,
    composerDraftFileCount,
    composerDraftImageCount,
    ensureLiveRuntime,
    runBrowserAction,
    threadId,
    setLocalError,
  ]);

  const onCopyScreenshotToClipboard = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }

    void runBrowserAction(() =>
      api.browser.copyScreenshotToClipboard({ threadId, tabId: activeTab.id }),
    ).then((result) => {
      if (result === null) {
        return;
      }
      const anchor = copyScreenshotButtonRef.current;
      if (anchor) {
        anchoredToastManager.add({
          data: {
            tooltipStyle: true,
          },
          positionerProps: {
            anchor,
          },
          timeout: 1_200,
          title: "Browser screenshot copied",
        });
        return;
      }

      toastManager.add({
        type: "success",
        title: "Browser screenshot copied",
      });
    });
  }, [activeTab, api, ensureLiveRuntime, runBrowserAction, threadId, copyScreenshotButtonRef]);

  const copyActiveTabLink = useCallback(() => {
    if (!activeTab) {
      return;
    }

    if (isElectron && api) {
      void runBrowserAction(() => api.browser.copyLink({ threadId, tabId: activeTab.id }));
      return;
    }
    const url = resolveCopyableBrowserTabUrl(activeTab);
    if (!url) {
      return;
    }
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) {
      return;
    }
    void clipboard.writeText(url).then(
      () => {
        toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
      },
      () => {},
    );
  }, [activeTab, api, runBrowserAction, threadId]);

  useEffect(() => {
    if (!isLiveRuntime) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const matches = isBrowserCopyLinkChord(
        {
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          key: event.key,
        },
        isMacNavigatorPlatform(),
      );
      if (!matches) {
        return;
      }
      event.preventDefault();
      copyActiveTabLink();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [copyActiveTabLink, isLiveRuntime]);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }
    return api.browser.onCopyLink((event) => {
      if (event.threadId !== threadId) {
        return;
      }
      toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
    });
  }, [api, isLiveRuntime, threadId]);

  const onCloseTab = useCallback(
    (tabId: string) => {
      if (!ensureLiveRuntime()) {
        return;
      }
      if (!api) {
        return;
      }
      void runBrowserAction(() => api.browser.closeTab({ threadId, tabId })).then((state) => {
        if (!state) {
          return;
        }
        upsertThreadState(state);
        if (!state.open && state.tabs.length === 0) {
          onClosePanel();
        }
      });
    },
    [api, ensureLiveRuntime, onClosePanel, runBrowserAction, threadId, upsertThreadState],
  );
  return {
    onSubmitAddress,
    onReloadActiveTab,
    onSelectTab,
    onChooseSuggestion,
    onOpenLocalServer,
    onCreateTab,
    onCaptureScreenshot,
    onCopyScreenshotToClipboard,
    copyActiveTabLink,
    onCloseTab,
  } as const;
}
