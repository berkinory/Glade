import { useCallback, useRef } from "react";
import { prepareTerminalSession } from "../../terminal/terminalStartup";
import { resolveThreadWorkspaceState } from "@glade/shared/threads/threadEnvironment";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useState } from "react";
import { resolveDefaultEnvironmentPanelOpen } from "../../ChatView.logic.session";
import {
  resolveEnvironmentPanelOpen,
  resolveEnvironmentPanelPreferenceUpdate,
  resolveEnvironmentPanelVisible,
} from "../../ChatView.logic.worktree";
import type { TurnDispatchSettings } from "../../ChatView.logic.subagents";
import { useChatRuntimeModes } from "~/components/chat/useChatRuntimeModes";
import { useChatTranscriptScroll } from "~/components/chat/useChatTranscriptScroll";
import { useTranscriptAssistantSelectionAction } from "~/components/chat/useTranscriptAssistantSelectionAction";
import {
  resolveNextComposerFooterTier,
  shouldUseCompactComposerFooter,
} from "~/components/composerFooterLayout";
import { collapseExpandedComposerCursor, detectComposerTrigger } from "~/composer-logic";
import type { DraftThreadEnvMode } from "../../../composerDraftDomain";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { useThreadWorkspaceHandoff } from "~/hooks/useThreadWorkspaceHandoff";
import { gitGithubRepositoryQueryOptions } from "../../../lib/gitQueryOptions";
import { resolveThreadEnvironmentMode } from "@glade/shared/threads/threadEnvironment";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useProjectPreferencesStore } from "~/projectPreferencesStore";
import { useWorkspaceSidebarStore } from "~/workspaceSidebarStore";
import { useChatThreadContext } from "../ChatThreadContext";
import type { useChatComposerController } from "./useChatComposerController";
import type { useChatDiscoveryController } from "./useChatDiscoveryController";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatTranscriptController } from "./useChatTranscriptController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatEnvironmentController({
  session,
  discovery,
  transcript,
  workspace,
  composer,
  provider,
}: {
  session: ReturnType<typeof useChatSessionController>;
  discovery: ReturnType<typeof useChatDiscoveryController>;
  transcript: ReturnType<typeof useChatTranscriptController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  composer: ReturnType<typeof useChatComposerController>;
  provider: ReturnType<typeof useChatProviderController>;
}) {
  const { threadId } = useChatThreadContext();
  const {
    hideHeader,
    settings,
    updateSettings,
    activeThread,

    legendListRef,
    composerTranscriptInsetPx,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    addComposerAssistantSelectionToDraft,
    composerFormRef,
    setIsComposerFooterCompact,
    composerFooterTierRef,
    composerFooterDemotionWidthsRef,
    setComposerFooterTier,
    composerFooterLayoutSyncRef,

    setPullRequestDialogState,
    setComposerHighlightedItemId,
    setIsRevertingCheckpoint,
    setExpandedImage,
    dragDepthRef,
    setComposerCursor,
    promptRef,
    setComposerTrigger,
    setIsDragOverComposer,
    expandedImage,
    setComposerCommandPicker,
    draftThread,
    assistantDeliveryMode,
    terminalOpenByThreadRef,
    activatedThreadIdRef,
  } = session;
  const {
    isTerminalEnvironmentContext,
    isTerminalPrimarySurface,
    threadTerminalRuntimeEnv,
    composerMenuOpen,
    composerMenuItems,
  } = discovery;
  const {
    isCenteredEmptyLanding,
    gitBranchSourceCwd,
    gitCwd,
    activeRootBranch,
    timelineEntries,
    isComposerApprovalState,
    composerFooterHasWideActions,
  } = transcript;
  const {
    activeProject,
    terminalState,
    terminalFocusRequestId,
    handleTerminalSessionExited,
    activeThreadId,
    setTerminalHeight,
    storeSetTerminalMetadata,
    storeSetTerminalActivity,
    requestTerminalFocus,
    isServerThread,
    activeThreadAssociatedWorktree,
    runtimeMode,

    setRenameDialogOpen,
    resolvedThreadEnvMode,
    resolvedThreadWorktreePath,
    storeOpenTerminalThreadPage,
    terminalWorkspaceOpen,
  } = workspace;
  const {
    canAddTerminalContextToChat,
    addTerminalContextToDraft,
    scheduleComposerFocus,
    focusComposer,
  } = composer;
  const {
    selectedModelSelection,

    hasStreamingAssistantText,
    pendingUserInputs,
    providerOptionsForDispatch,
  } = provider;

  const rightDockOpen = useWorkspaceSidebarStore((store) => store.open);

  const isMobileViewport = useIsMobile();

  const environmentEnabled = !hideHeader;

  const environmentUsesFloatingOverlay = isTerminalEnvironmentContext || isMobileViewport;

  const environmentDefaultOpen = resolveDefaultEnvironmentPanelOpen({
    environmentEnabled,
    isCenteredEmptyLanding,
    isTerminalPrimarySurface,
    isConstrainedChatLayout: environmentUsesFloatingOverlay,
    settingsDefaultOpen: settings.environmentPanelDefaultOpen,
  });

  const [environmentPanelPreferenceOpen, setEnvironmentPanelPreferenceOpen] = useState<
    boolean | null
  >(null);

  const updateEnvironmentPanelPreference = (open: boolean, persist: boolean) => {
    const update = resolveEnvironmentPanelPreferenceUpdate({ open, persist });
    setEnvironmentPanelPreferenceOpen(update.userPreferenceOpen);
    if (update.settingsDefaultOpen !== null) {
      updateSettings({ environmentPanelDefaultOpen: update.settingsDefaultOpen });
    }
  };

  const setEnvironmentPanelOpenPreference = (open: boolean) =>
    updateEnvironmentPanelPreference(open, true);

  const closeEnvironmentPanelAfterAction = () => updateEnvironmentPanelPreference(false, false);

  const environmentPanelOpen = resolveEnvironmentPanelOpen({
    defaultOpen: environmentDefaultOpen,
    userPreferenceOpen: environmentPanelPreferenceOpen,
  });

  const environmentPanelVisible =
    !rightDockOpen &&
    resolveEnvironmentPanelVisible({
      environmentEnabled,
      environmentPanelOpen,
    });

  useLayoutEffect(() => {
    if (!rightDockOpen) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.closest("[data-environment-panel]") || active.closest("[data-environment-toggle]"))
    )
      focusComposer();
  }, [rightDockOpen, focusComposer]);

  const githubRepositoryQuery = useQuery(
    gitGithubRepositoryQueryOptions(gitBranchSourceCwd, environmentPanelVisible),
  );

  const startedTerminalIds = useRef(new Set<string>());
  const terminalCwd = gitCwd ?? activeProject?.cwd ?? "";
  useEffect(() => {
    if (!terminalState.terminalOpen || !terminalCwd) return;
    const api = readNativeApi();
    if (!api) return;
    for (const terminalId of terminalState.terminalIds) {
      const key = `${threadId}:${terminalId}`;
      if (startedTerminalIds.current.has(key)) continue;
      startedTerminalIds.current.add(key);
      prepareTerminalSession(api, {
        threadId,
        terminalId,
        cwd: terminalCwd,
        cols: 80,
        rows: 24,
        ...(threadTerminalRuntimeEnv ? { env: threadTerminalRuntimeEnv } : {}),
      });
    }
  }, [
    threadId,
    terminalState.terminalOpen,
    terminalState.terminalIds,
    terminalCwd,
    threadTerminalRuntimeEnv,
  ]);

  const terminalDrawerProps = {
    threadId,
    cwd: terminalCwd,
    runtimeEnv: threadTerminalRuntimeEnv,
    height: terminalState.terminalHeight,
    terminalIds: terminalState.terminalIds,
    terminalLabelsById: terminalState.terminalLabelsById,
    terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
    terminalCliKindsById: terminalState.terminalCliKindsById,
    terminalAttentionStatesById: terminalState.terminalAttentionStatesById ?? {},
    runningTerminalIds: terminalState.runningTerminalIds,
    activeTerminalId: terminalState.activeTerminalId,
    focusRequestId: terminalFocusRequestId,
    onTerminalSessionExited: handleTerminalSessionExited,
    onHeightChange: setTerminalHeight,
    onTerminalMetadataChange: (
      terminalId: string,
      metadata: {
        cliKind: "codex" | "claude" | null;
        label: string;
      },
    ) => {
      if (!activeThreadId) return;
      storeSetTerminalMetadata(activeThreadId, terminalId, metadata);
    },
    onTerminalActivityChange: (
      terminalId: string,
      activity: {
        hasRunningSubprocess: boolean;
        agentState: "running" | "attention" | "review" | null;
      },
    ) => {
      if (!activeThreadId) return;
      storeSetTerminalActivity(activeThreadId, terminalId, activity);
    },
    ...(canAddTerminalContextToChat ? { onAddTerminalContext: addTerminalContextToDraft } : {}),
  };

  const stopActiveThreadSession = async () => {
    const api = readNativeApi();
    if (
      !api ||
      !isServerThread ||
      !activeThread ||
      activeThread.session === null ||
      activeThread.session.status === "closed"
    ) {
      return;
    }

    await api.orchestration.dispatchCommand({
      type: "thread.session.stop",
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    });
  };

  const { handoffBusy, onHandoffToLocal } = useThreadWorkspaceHandoff({
    activeProject,
    activeThread,
    activeRootBranch,
    activeThreadAssociatedWorktree,
    isServerThread,
    stopActiveThreadSession,
  });

  const {
    persistRuntimeModeChange,
    handleRuntimeModeChange,

    persistThreadSettingsForNextTurn,
  } = useChatRuntimeModes({ session, workspace, provider, discovery, composer });

  const {
    showScrollToBottom,
    isUserScrollDetached,
    tailAnchorScrollInFlightRef,
    armTranscriptAutoFollow,
    onTranscriptNavigate,
    onIsAtEndChange,
    onScrollToBottom,
    onMessagesClickCaptureBase,
    onMessagesPointerDownBase,
    onMessagesPointerUpBase,
    onMessagesPointerCancelBase,
    onMessagesScrollBase,
    onMessagesTouchEndBase,
    onMessagesTouchMoveBase,
    onMessagesTouchStartBase,
    onMessagesWheelBase,
  } = useChatTranscriptScroll({
    activeThreadId,
    legendListRef,
    timelineEntries,
    hasStreamingAssistantText,
    composerTranscriptInsetPx,
  });

  const selectionChatEnvMode = useProjectPreferencesStore((state) =>
    activeProject ? state.envModeByProjectId[activeProject.id] : undefined,
  );

  const {
    pendingTranscriptSelectionAction,
    commitTranscriptAssistantSelection,
    dismissTranscriptSelectionAction,
    onMessagesClickCapture,
    onMessagesMouseUp,
    onMessagesPointerCancel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesScroll,
    onMessagesTouchEnd,
    onMessagesTouchMove,
    onMessagesTouchStart,
    onMessagesWheel,
  } = useTranscriptAssistantSelectionAction({
    scope: {
      threadId,
      enabled: Boolean(activeThread) && pendingUserInputs.length === 0 && !isComposerApprovalState,
    },
    composer: {
      composerImagesRef,
      composerFilesRef,
      composerAssistantSelectionsRef,
      addComposerAssistantSelectionToDraft,
      scheduleComposerFocus,
    },
    events: {
      onMessagesClickCaptureBase,
      onMessagesPointerCancelBase,
      onMessagesPointerDownBase,
      onMessagesPointerUpBase,
      onMessagesScrollBase,
      onMessagesTouchEndBase,
      onMessagesTouchMoveBase,
      onMessagesTouchStartBase,
      onMessagesWheelBase,
    },
  });

  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;
    const syncComposerFooterLayout = () => {
      const composerFormWidth = measureComposerFormWidth();
      const nextCompact = shouldUseCompactComposerFooter(composerFormWidth, {
        hasWideActions: composerFooterHasWideActions,
      });
      setIsComposerFooterCompact((previous) => (previous === nextCompact ? previous : nextCompact));

      const footerRow = composerForm.querySelector<HTMLElement>("[data-chat-composer-footer]");
      if (footerRow) {
        const rowOverflows = footerRow.scrollWidth > footerRow.clientWidth + 1;

        const leadingCluster = footerRow.querySelector<HTMLElement>("[data-chat-composer-leading]");
        const leadingClips =
          nextCompact &&
          leadingCluster !== null &&
          leadingCluster.scrollWidth > leadingCluster.clientWidth + 1;
        const nextStep = resolveNextComposerFooterTier({
          currentTier: composerFooterTierRef.current,
          clientWidth: footerRow.clientWidth,
          isOverflowing: rowOverflows || leadingClips,
          demotionWidths: composerFooterDemotionWidthsRef.current,
        });
        composerFooterDemotionWidthsRef.current = nextStep.demotionWidths;
        if (nextStep.tier !== composerFooterTierRef.current) {
          composerFooterTierRef.current = nextStep.tier;
          setComposerFooterTier(nextStep.tier);
        }
      }
    };
    composerFooterLayoutSyncRef.current = syncComposerFooterLayout;

    syncComposerFooterLayout();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      syncComposerFooterLayout();
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [
    setIsComposerFooterCompact,
    setComposerFooterTier,
    composerFooterTierRef,
    composerFooterDemotionWidthsRef,
    composerFooterLayoutSyncRef,
    composerFormRef,
    activeThread?.id,
    composerFooterHasWideActions,
  ]);

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setPullRequestDialogState(null);
      setRenameDialogOpen(false);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setPullRequestDialogState, setRenameDialogOpen, activeThread?.id]);

  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      return;
    }
    setComposerHighlightedItemId((existing) =>
      existing && composerMenuItems.some((item) => item.id === existing)
        ? existing
        : (composerMenuItems[0]?.id ?? null),
    );
  }, [setComposerHighlightedItemId, composerMenuItems, composerMenuOpen]);

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setIsRevertingCheckpoint(false);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setIsRevertingCheckpoint, activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

  useLayoutEffect(() => {
    setExpandedImage(null);
  }, [setExpandedImage, threadId]);

  useEffect(() => {
    dragDepthRef.current = 0;

    const settle = window.setTimeout(() => {
      setComposerHighlightedItemId(null);
      setComposerCursor(
        collapseExpandedComposerCursor(promptRef.current, promptRef.current.length),
      );
      setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
      setIsDragOverComposer(false);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    setIsDragOverComposer,
    setComposerHighlightedItemId,
    dragDepthRef,
    threadId,
  ]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, [setExpandedImage]);

  const navigateExpandedImage = useCallback(
    (direction: -1 | 1) => {
      setExpandedImage((existing) => {
        if (!existing || existing.images.length <= 1) {
          return existing;
        }
        const nextIndex =
          (existing.index + direction + existing.images.length) % existing.images.length;
        if (nextIndex === existing.index) {
          return existing;
        }
        return { ...existing, index: nextIndex };
      });
    },
    [setExpandedImage],
  );

  useEffect(() => {
    if (!expandedImage) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeExpandedImage();
        return;
      }
      if (expandedImage.images.length <= 1) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateExpandedImage(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateExpandedImage(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeExpandedImage, expandedImage, navigateExpandedImage]);

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setPullRequestDialogState(null);
      setRenameDialogOpen(false);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setPullRequestDialogState, setRenameDialogOpen, activeThread?.id]);

  useEffect(() => {
    if (!composerMenuOpen) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setComposerCommandPicker(null);
      setComposerHighlightedItemId(null);
      setComposerTrigger(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    setComposerTrigger,
    setComposerCommandPicker,
    setComposerHighlightedItemId,
    composerMenuOpen,
  ]);

  const activeWorktreePath = activeThread?.worktreePath;

  const envMode: DraftThreadEnvMode = isServerThread
    ? resolveThreadEnvironmentMode({
        envMode: activeThread?.envMode,
        worktreePath: activeWorktreePath ?? null,
      })
    : (draftThread?.envMode ?? "local");

  const envState = resolveThreadWorkspaceState({
    envMode: resolvedThreadEnvMode,
    worktreePath: resolvedThreadWorktreePath,
  });

  const turnDispatchSettings: TurnDispatchSettings = {
    modelSelection: selectedModelSelection,
    providerOptions: providerOptionsForDispatch,
    assistantDeliveryMode,
    runtimeMode,

    envMode,
  };

  useEffect(() => {
    if (!activeThreadId) return;
    const previous = terminalOpenByThreadRef.current[activeThreadId] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      requestTerminalFocus();
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadId] = current;
  }, [
    terminalOpenByThreadRef,
    activeThreadId,
    focusComposer,
    requestTerminalFocus,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      activatedThreadIdRef.current = null;
      return;
    }
    if (activatedThreadIdRef.current === activeThreadId) {
      return;
    }
    activatedThreadIdRef.current = activeThreadId;
    if (terminalState.entryPoint !== "terminal") {
      return;
    }
    storeOpenTerminalThreadPage(activeThreadId);
  }, [activatedThreadIdRef, activeThreadId, storeOpenTerminalThreadPage, terminalState.entryPoint]);

  useEffect(() => {
    if (!terminalWorkspaceOpen) {
      return;
    }

    if (terminalState.workspaceActiveTab === "terminal") {
      requestTerminalFocus();
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    focusComposer,
    requestTerminalFocus,
    terminalState.workspaceActiveTab,
    terminalWorkspaceOpen,
  ]);
  return {
    rightDockOpen,
    environmentEnabled,
    environmentUsesFloatingOverlay,
    environmentPanelPreferenceOpen,
    setEnvironmentPanelPreferenceOpen,
    setEnvironmentPanelOpenPreference,
    closeEnvironmentPanelAfterAction,
    environmentPanelVisible,
    githubRepositoryQuery,
    terminalDrawerProps,
    handoffBusy,
    onHandoffToLocal,
    persistRuntimeModeChange,
    handleRuntimeModeChange,

    persistThreadSettingsForNextTurn,

    showScrollToBottom,
    isUserScrollDetached,
    tailAnchorScrollInFlightRef,
    armTranscriptAutoFollow,
    onTranscriptNavigate,
    onIsAtEndChange,
    onScrollToBottom,
    selectionChatEnvMode,
    pendingTranscriptSelectionAction,
    commitTranscriptAssistantSelection,
    dismissTranscriptSelectionAction,
    onMessagesClickCapture,
    onMessagesMouseUp,
    onMessagesPointerCancel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesScroll,
    onMessagesTouchEnd,
    onMessagesTouchMove,
    onMessagesTouchStart,
    onMessagesWheel,
    closeExpandedImage,
    navigateExpandedImage,
    envMode,
    envState,
    turnDispatchSettings,
  } as const;
}
