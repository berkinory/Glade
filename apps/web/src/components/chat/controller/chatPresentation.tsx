import { FolderIcon } from "~/lib/icons";
import BranchToolbar, { RuntimeUsageControls } from "~/components/BranchToolbar";
import { resolveActiveThreadTitle } from "../../ChatView.logic.worktree";
import { ComposerStackedPanel } from "~/components/chat/ComposerStackedPanel";
import { ComposerExtrasTrigger } from "~/components/chat/ComposerExtrasTrigger";
import { ProjectPicker } from "~/components/chat/ProjectPicker";
import {
  COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME,
  COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import {
  ENVIRONMENT_DOCKED_CONTENT_INSET_PX,
  type EnvironmentPanelProps,
} from "~/components/chat/environment/EnvironmentPanel";
import { toastManager } from "~/components/ui/toast";
import { openExternalLink } from "~/lib/linkChips";
import { resolveSubagentPresentationForThread } from "~/lib/subagentPresentation";
import { buildDraftThreadRenameCreateInput, dispatchThreadRename } from "~/lib/threadRename";
import { cn } from "~/lib/utils";
import { isElectron } from "~/env";
import { EnvironmentPicker } from "../EnvironmentPicker";
import { RemoteEnvironmentStatus } from "../RemoteEnvironmentStatus";
import { COMPOSER_EXTRAS_PANEL_ID } from "./chatViewSupport";
import type { ChatController } from "./useChatController";
export function createChatPresentation(
  controller: ChatController,
  activeThread: NonNullable<ChatController["session"]["activeThread"]>,
) {
  const {
    isComposerExtrasPanelOpen,
    setIsComposerExtrasPanelOpen,
    onRegisterCommitAndPushTrigger,
  } = controller.session;
  const {
    threadLineageThreads,
    isChatProject,
    isLocalDraftThread,
    runtimeMode,
    activeCumulativeCostUsd,
    canCheckoutPullRequestIntoThread,
    openPullRequestDialog,
    activeProject,
    isHomeChatContainer,
    activeProjectDisplayName,
    resolvedThreadWorktreePath,
    resolvedDiffOpen,
    diffDisabledReason,
    latestTurnLive,
  } = controller.workspace;
  const {
    timelineEntries,
    threadDetailHydration,
    isCenteredEmptyLanding,
    isEmptyChatLanding,
    threadWorkspaceCwd,
    pinnedMessages,
    pinnedMessageTextById,
    threadNotes,
    handleJumpToPinnedMessage,
    handleJumpToToolCall,
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
  } = controller.transcript;
  const { selectedProvider, selectedRuntimeModel, workflowRunState } = controller.provider;
  const {
    activeProviderStatus,
    envLocked,
    isGitRepo,
    keybindings,
    availableEditors,
    showGitActions,
    repoDiffTotals,
    onToggleDiff,
    activeTurnLiveDiffState,
  } = controller.discovery;
  const {
    handleRuntimeModeChange,
    onHandoffToLocal,
    handoffBusy,
    githubRepositoryQuery,
    closeEnvironmentPanelAfterAction,
    environmentPanelVisible,
    environmentUsesFloatingOverlay,
    environmentEnabled,
    rightDockOpen,
    setEnvironmentPanelOpenPreference,
  } = controller.environment;
  const {
    runtimeUsageContextWindow,
    contextWindowSelectionStatus,
    composerFooterControlsPlan,
    onEnvModeChange,
    handleSelectWorkspaceRoot,
    handleResetWorkspaceToHome,
    handleSelectEnvironmentForEmptyDraft,
    handleSelectProjectForEmptyDraft,
    handleCreateProjectFromPickerPath,
  } = controller.submission;
  const { scheduleComposerFocus, isVoiceRecording, isVoiceTranscribing } = controller.composer;
  const activeThreadDisplayTitle = resolveActiveThreadTitle({
    title: activeThread.title,
    subagentTitle: activeThread.parentThreadId
      ? resolveSubagentPresentationForThread({
          thread: activeThread,
          threads: threadLineageThreads,
        }).fullLabel
      : null,
    isHomeChat: isChatProject,
    isEmpty: timelineEntries.length === 0,
  });
  const handleRenameActiveThread = async (newTitle: string) => {
    const outcome = await dispatchThreadRename({
      threadId: activeThread.id,
      newTitle,
      unchangedTitles: [activeThread.title],
      createIfMissing: isLocalDraftThread
        ? buildDraftThreadRenameCreateInput(activeThread)
        : undefined,
    }).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to rename chat",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      throw error;
    });
    if (outcome === "empty") {
      toastManager.add({
        type: "warning",
        title: "Chat title cannot be empty",
      });
      return;
    }
    if (outcome === "unchanged" || outcome === "unavailable") {
      return;
    }
  };
  const runtimeUsageControlsProps = {
    provider: selectedProvider,
    runtimeModel: selectedRuntimeModel,
    providerStatus: activeProviderStatus,
    runtimeMode,
    onRuntimeModeChange: handleRuntimeModeChange,
    contextWindow: runtimeUsageContextWindow,
    cumulativeCostUsd: activeCumulativeCostUsd,
    activeContextWindowLabel: contextWindowSelectionStatus.activeLabel,
    pendingContextWindowLabel: contextWindowSelectionStatus.pendingSelectedLabel,
  };
  const relocateComposerLeadingControls = composerFooterControlsPlan.relocateLeadingControls;
  const renderComposerFooterControls = (options: { iconOnly: boolean }) => ({
    leading: (
      <ComposerExtrasTrigger
        open={isComposerExtrasPanelOpen}
        panelId={COMPOSER_EXTRAS_PANEL_ID}
        onToggle={() => {
          setIsComposerExtrasPanelOpen((open) => !open);
          scheduleComposerFocus();
        }}
      />
    ),
    runtime:
      !isVoiceRecording && !isVoiceTranscribing ? (
        <RuntimeUsageControls
          {...runtimeUsageControlsProps}
          className="shrink-0"
          hideLabel={options.iconOnly}
        />
      ) : null,
  });
  const branchToolbarProps = {
    threadId: activeThread.id,
    onEnvModeChange,
    envLocked,
    threadDetailReady: threadDetailHydration === "ready",
    onHandoffToLocal,
    handoffBusy,
    onComposerFocusRequest: scheduleComposerFocus,
    ...(canCheckoutPullRequestIntoThread
      ? {
          onCheckoutPullRequestRequest: openPullRequestDialog,
        }
      : {}),
  };
  const showComposerBranchToolbar = activeProject?.kind === "project" && !isHomeChatContainer;
  // A host's Home chats have no project picker of their own, so they offer the host's projects.
  const showEmptyLandingProjectPicker =
    isCenteredEmptyLanding &&
    isLocalDraftThread &&
    (activeProject?.kind === "project" || activeProject?.environmentKey !== undefined);
  const showEnvironmentPicker = isElectron && isCenteredEmptyLanding && isLocalDraftThread;
  const showContainerChatWorkspacePicker = isEmptyChatLanding && isHomeChatContainer;
  const composerProjectChip =
    !showContainerChatWorkspacePicker &&
    !showEmptyLandingProjectPicker &&
    activeProjectDisplayName ? (
      <span
        className={cn(
          "inline-flex min-w-0 max-w-56 shrink items-center gap-1.5 overflow-hidden rounded-full px-1.5 py-1 sm:max-w-64",
          COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
        )}
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{activeProjectDisplayName}</span>
      </span>
    ) : null;
  const showComposerContextControls =
    isCenteredEmptyLanding &&
    (showEnvironmentPicker ||
      isEmptyChatLanding ||
      showEmptyLandingProjectPicker ||
      composerProjectChip !== null ||
      showComposerBranchToolbar);
  const composerContextControls = showComposerContextControls ? (
    <ComposerStackedPanel
      data-composer-context-controls="true"
      className="isolate flex min-h-9 w-9/10 min-w-0 flex-wrap items-center gap-0.5 px-1.5 py-0.5 [--composer-glass-stacked-opacity:80%] [--composer-glass-surface:var(--color-background-button-secondary)]"
      attachedToPrevious={
        (latestTurnLive && activeTurnLiveDiffState.hasChanges) ||
        workflowRunState !== null ||
        controller.session.queuedComposerTurns.length > 0
      }
    >
      {showEnvironmentPicker ? (
        <EnvironmentPicker
          onSelectEnvironment={handleSelectEnvironmentForEmptyDraft}
          triggerClassName={cn(
            "h-7 px-2 py-1",
            COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME,
            COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
          )}
        />
      ) : null}
      {showContainerChatWorkspacePicker ? (
        <ProjectPicker
          align="start"
          side="top"
          triggerVariant="ghost"
          triggerClassName={cn(
            "h-7 px-2 py-1",
            COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME,
            COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
          )}
          showResetToHome={Boolean(resolvedThreadWorktreePath)}
          selectedWorkspaceRoot={resolvedThreadWorktreePath}
          onSelectWorkspaceRoot={handleSelectWorkspaceRoot}
          onResetToHome={handleResetWorkspaceToHome}
          onSelectProject={handleSelectProjectForEmptyDraft}
          onCreateProjectFromPath={handleCreateProjectFromPickerPath}
        />
      ) : showEmptyLandingProjectPicker ? (
        <ProjectPicker
          align="start"
          side="top"
          triggerVariant="ghost"
          triggerClassName={cn(
            "h-7 px-2 py-1",
            COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME,
            COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
          )}
          selectionMode="project"
          selectedProjectId={activeProject.kind === "project" ? activeProject.id : null}
          selectedWorkspaceRoot={activeProject.kind === "project" ? activeProject.cwd : null}
          showResetToHome={activeProject.kind === "project"}
          onSelectProject={handleSelectProjectForEmptyDraft}
          onCreateProjectFromPath={handleCreateProjectFromPickerPath}
          onResetToHome={handleResetWorkspaceToHome}
        />
      ) : (
        composerProjectChip
      )}
      {!showEnvironmentPicker ? <RemoteEnvironmentStatus variant="composer" /> : null}
      <div
        aria-hidden={showComposerBranchToolbar ? undefined : true}
        className={cn(
          "flex min-w-0 flex-1 items-center transition-[opacity,transform] duration-(--ui-motion-default-duration) ease-out motion-reduce:transition-none",
          showComposerBranchToolbar
            ? "min-w-[min(100%,12rem)] translate-y-0 opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        {showComposerBranchToolbar ? (
          <BranchToolbar
            {...branchToolbarProps}
            className="mx-0 min-w-0 flex-1 !justify-start !px-0 !pb-0 !pt-0"
            showBranchSelector={isGitRepo}
          />
        ) : null}
      </div>
    </ComposerStackedPanel>
  ) : null;
  const environmentPanelProps: Omit<EnvironmentPanelProps, "open" | "variant"> = {
    gitCwd: threadWorkspaceCwd,
    openInTarget: threadWorkspaceCwd,
    worktree: {
      path: activeThread.worktreePath ?? null,
      baseDirectory: activeThread.workingDirectory ?? activeProject?.cwd ?? null,
      pending: activeThread.envMode === "worktree" && !activeThread.worktreePath,
    },
    githubRepository: githubRepositoryQuery.data?.repository ?? null,
    isGitRepo,
    keybindings,
    availableEditors,
    activeThreadId: activeThread.id,
    activeProvider: activeThread.session?.provider ?? activeThread.modelSelection.provider,
    showGitActions,
    diffOpen: resolvedDiffOpen,
    diffDisabledReason,
    diffTotals: repoDiffTotals,
    branchToolbar: branchToolbarProps,
    pinnedMessages,
    pinnedMessageTextById,
    notes: threadNotes,
    onToggleDiff,
    onOpenGithubRepository: openExternalLink,
    onJumpToPinnedMessage: handleJumpToPinnedMessage,
    onJumpToToolCall: handleJumpToToolCall,
    onUnpinMessage: handleUnpinMessage,
    onRenamePinnedMessage: handleRenamePinnedMessage,
    onNotesChange: handleNotesChange,
    onClose: closeEnvironmentPanelAfterAction,
    onRegisterCommitAndPushTrigger,
  };
  const environmentAppliesContentInset = environmentPanelVisible && !environmentUsesFloatingOverlay;
  const environmentOverlayVariant = environmentUsesFloatingOverlay ? "floating" : "docked";
  const environmentInsetPx = environmentAppliesContentInset
    ? ENVIRONMENT_DOCKED_CONTENT_INSET_PX
    : 0;
  const contentInsetRightPx = environmentInsetPx > 0 ? environmentInsetPx : undefined;
  const environmentHeaderState =
    environmentEnabled && !rightDockOpen
      ? {
          open: environmentPanelVisible,
          onOpenChange: setEnvironmentPanelOpenPreference,
        }
      : null;
  const showComposerLiveChangesHeader = latestTurnLive && activeTurnLiveDiffState.hasChanges;
  const showComposerWorkflowRunCard = workflowRunState !== null;
  return {
    showComposerLiveChangesHeader,
    showComposerWorkflowRunCard,
    composerContextControls,
    relocateComposerLeadingControls,
    renderComposerFooterControls,
    activeThreadDisplayTitle,
    environmentHeaderState,
    handleRenameActiveThread,
    showEmptyLandingProjectPicker,
    contentInsetRightPx,
    branchToolbarProps,
    environmentPanelProps,
    environmentOverlayVariant,
  } as const;
}
