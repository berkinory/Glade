import { FolderIcon } from "~/lib/icons";
import BranchToolbar, { RuntimeUsageControls } from "~/components/BranchToolbar";
import { resolveActiveThreadTitle } from "../../ChatView.logic.worktree";
import { ComposerActiveTaskListCard } from "~/components/chat/ComposerActiveTaskListCard";
import { ComposerExtrasTrigger } from "~/components/chat/ComposerExtrasTrigger";
import { ProjectPicker } from "~/components/chat/ProjectPicker";
import {
  COMPOSER_FOLDER_PICKER_CAPSULE_HOVER_CLASS_NAME,
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
import { COMPOSER_EXTRAS_PANEL_ID } from "./chatViewSupport";
import type { ChatController } from "./useChatController";
export function createChatPresentation(
  controller: ChatController,
  activeThread: NonNullable<ChatController["session"]["activeThread"]>,
) {
  const {
    taskListSidebarOpen,
    setTaskListSidebarOpen,
    isComposerExtrasPanelOpen,
    setIsComposerExtrasPanelOpen,
    onRegisterCommitAndPushTrigger,
    activeTaskListCompact,
    setActiveTaskListCompact,
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
    activeProjectId,
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
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
  } = controller.transcript;
  const {
    selectedProvider,
    selectedRuntimeModel,
    activeTaskList,
    workflowRunState,
    composerSubagentStripItems,
    activeBackgroundTasks,
  } = controller.provider;
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
        title: "Failed to rename thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      throw error;
    });
    if (outcome === "empty") {
      toastManager.add({
        type: "warning",
        title: "Thread title cannot be empty",
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
  const renderComposerLeadingControls = (options: { iconOnly: boolean }) => (
    <>
      <ComposerExtrasTrigger
        open={isComposerExtrasPanelOpen}
        panelId={COMPOSER_EXTRAS_PANEL_ID}
        onToggle={() => {
          setIsComposerExtrasPanelOpen((open) => !open);
          scheduleComposerFocus();
        }}
      />
      {!isVoiceRecording && !isVoiceTranscribing ? (
        <RuntimeUsageControls
          {...runtimeUsageControlsProps}
          className="shrink-0"
          hideLabel={options.iconOnly}
        />
      ) : null}
    </>
  );
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
  const showEmptyLandingBranchToolbar =
    isCenteredEmptyLanding && activeProject?.kind === "project" && !isHomeChatContainer;
  const showEmptyLandingProjectPicker =
    isCenteredEmptyLanding && isLocalDraftThread && activeProject?.kind === "project";
  const showContainerChatWorkspacePicker = isEmptyChatLanding && isHomeChatContainer;
  const emptyLandingProjectChip =
    !showContainerChatWorkspacePicker &&
    !showEmptyLandingProjectPicker &&
    activeProjectDisplayName ? (
      <span
        className={cn(
          "inline-flex min-w-0 max-w-56 shrink items-center gap-2 overflow-hidden rounded-full px-2 py-1 sm:max-w-64",
          COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
        )}
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{activeProjectDisplayName}</span>
      </span>
    ) : null;
  const showEmptyLandingControls =
    isCenteredEmptyLanding &&
    (isEmptyChatLanding ||
      showEmptyLandingProjectPicker ||
      emptyLandingProjectChip !== null ||
      showEmptyLandingBranchToolbar);
  const emptyLandingControls = showEmptyLandingControls ? (
    <div
      data-empty-landing-controls="true"
      className="chat-composer-shell mx-auto flex min-h-8 w-full min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden !rounded-b-none !rounded-t-[var(--composer-radius)] px-1.5 py-1 transition-colors duration-100 ease-out motion-reduce:transition-none sm:min-h-7"
    >
      {showContainerChatWorkspacePicker ? (
        <ProjectPicker
          align="start"
          side="top"
          triggerVariant="ghost"
          triggerClassName={cn(
            "h-8 px-2 py-1 sm:h-7 sm:px-2.5",
            COMPOSER_FOLDER_PICKER_CAPSULE_HOVER_CLASS_NAME,
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
            "h-8 px-2 py-1 sm:h-7 sm:px-2.5",
            COMPOSER_FOLDER_PICKER_CAPSULE_HOVER_CLASS_NAME,
            COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
          )}
          selectionMode="project"
          selectedProjectId={activeProject.id}
          selectedWorkspaceRoot={activeProject.cwd}
          showResetToHome
          onSelectProject={handleSelectProjectForEmptyDraft}
          onCreateProjectFromPath={handleCreateProjectFromPickerPath}
          onResetToHome={handleResetWorkspaceToHome}
        />
      ) : (
        emptyLandingProjectChip
      )}
      {}
      <div
        aria-hidden={showEmptyLandingBranchToolbar ? undefined : true}
        className={cn(
          "flex min-w-0 flex-1 items-center transition-[opacity,transform] duration-100 ease-out motion-reduce:transition-none",
          showEmptyLandingBranchToolbar
            ? "translate-y-0 opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        {showEmptyLandingBranchToolbar ? (
          <BranchToolbar
            {...branchToolbarProps}
            className="mx-0 min-w-0 flex-1 !justify-start !px-0 !pb-0 !pt-0"
            showBranchSelector={isGitRepo}
          />
        ) : null}
      </div>
    </div>
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
    githubRepositories: githubRepositoryQuery.data?.repositories ?? [],
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
    activeProjectId,
    onToggleDiff,
    onOpenGithubRepository: openExternalLink,
    onJumpToPinnedMessage: handleJumpToPinnedMessage,
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
  const showComposerActiveTaskListCard = Boolean(activeTaskList && !taskListSidebarOpen);
  const showComposerWorkflowRunCard = workflowRunState !== null;
  const showComposerSubagentStrip = composerSubagentStripItems.length > 0;
  const composerBackgroundTaskCount = workflowRunState
    ? (activeBackgroundTasks?.taskIds.filter((taskId) => !workflowRunState.taskIds.includes(taskId))
        .length ?? 0)
    : (activeBackgroundTasks?.activeCount ?? 0);
  const renderActiveTaskListCard = (attachedToPrevious: boolean) =>
    activeTaskList && showComposerActiveTaskListCard ? (
      <ComposerActiveTaskListCard
        activeTaskList={activeTaskList}
        backgroundTaskCount={composerBackgroundTaskCount}
        compact={activeTaskListCompact}
        onCompactChange={setActiveTaskListCompact}
        onOpenSidebar={() => setTaskListSidebarOpen(true)}
        attachedToPrevious={attachedToPrevious}
      />
    ) : null;
  return {
    showComposerLiveChangesHeader,
    renderActiveTaskListCard,
    showComposerActiveTaskListCard,
    showComposerSubagentStrip,
    showComposerWorkflowRunCard,
    emptyLandingControls,
    relocateComposerLeadingControls,
    renderComposerLeadingControls,
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
