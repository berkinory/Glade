import { type AutomationDefinition } from "@glade/contracts/automation/automation";
import BranchToolbar, { RuntimeUsageControls } from "~/components/BranchToolbar";
import { resolveActiveThreadTitle } from "../../ChatView.logic.worktree";
import { FolderClosed } from "~/components/FolderClosed";
import { ComposerActiveTaskListCard } from "~/components/chat/ComposerActiveTaskListCard";
import { ComposerExtrasTrigger } from "~/components/chat/ComposerExtrasTrigger";
import {
  computerPreviewBudgetPx,
  computerPreviewCardCaps,
  type ComputerPreviewSession,
} from "~/components/chat/ComputerPreviewPopover.logic";
import type { ComputerPreviewLayout } from "~/computerStateStore";
import { ProjectPicker } from "~/components/chat/ProjectPicker";
import { shouldShowComputerControlEffortHint } from "~/components/chat/composerComputerControlHint";
import {
  COMPOSER_FOLDER_PICKER_CAPSULE_HOVER_CLASS_NAME,
  COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import {
  ENVIRONMENT_DOCKED_CONTENT_INSET_PX,
  type EnvironmentPanelProps,
} from "~/components/chat/environment/EnvironmentPanel";
import { toastManager } from "~/components/ui/toast";
import { resolveSubagentPresentationForThread } from "~/lib/subagentPresentation";
import { buildDraftThreadRenameCreateInput, dispatchThreadRename } from "~/lib/threadRename";
import { cn } from "~/lib/utils";
import { automationsForThread } from "~/routes/-automations.shared";
import { COMPOSER_EXTRAS_PANEL_ID } from "./chatViewSupport";
import type { ChatController } from "./useChatController";
export function createChatPresentation(
  controller: ChatController,
  activeThread: NonNullable<ChatController["session"]["activeThread"]>,
  surface: {
    onOpenAutomation: (automationId: string) => void;
    mainContentWidth: number;
    previewSession: ComputerPreviewSession | undefined;
    previewLayout: ComputerPreviewLayout | undefined;
  },
) {
  const {
    isComposerExtrasPanelOpen,
    setIsComposerExtrasPanelOpen,
    onRegisterCommitAndPushTrigger,
    settings,
    planSidebarOpen,
    activeTaskListCompact,
    setActiveTaskListCompact,
    setPlanSidebarOpen,
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
    projectInstructions,
    setProjectInstructions,
    latestTurnLive,
    computerControlAvailable,
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
    handleCopyProjectInstructionsToNotes,
    handleJumpToPinnedMessage,
    handleTogglePinnedMessageDone,
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
  } = controller.transcript;
  const {
    selectedProvider,
    selectedRuntimeModel,
    automationData,
    activeTaskList,
    workflowRunState,
    composerSubagentStripItems,
    enableComputerControl,
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
    openBrowserUrl,
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
    composerTraitSelection,
  } = controller.submission;
  const { scheduleComposerFocus, isVoiceRecording, isVoiceTranscribing } = controller.composer;
  const { onOpenAutomation, mainContentWidth, previewSession, previewLayout } = surface;

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
      ? { onCheckoutPullRequestRequest: openPullRequestDialog }
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
        <FolderClosed className="size-3.5 shrink-0" />
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
      className="chat-composer-shell mx-auto flex min-h-8 w-full min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden !rounded-b-none !rounded-t-[var(--composer-radius)] px-1.5 py-1 transition-colors duration-120 ease-out motion-reduce:transition-none sm:min-h-7"
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
          "flex min-w-0 flex-1 items-center transition-[opacity,transform] duration-120 ease-out motion-reduce:transition-none",
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

  const threadAutomationItems = automationsForThread(
    automationData.definitions,
    activeThread.id,
  ).map((definition) => ({ definition }));

  const environmentPanelProps: Omit<EnvironmentPanelProps, "open" | "variant"> = {
    gitCwd: threadWorkspaceCwd,
    openInTarget: threadWorkspaceCwd,
    githubRepository: githubRepositoryQuery.data?.repository ?? null,
    githubRepositories: githubRepositoryQuery.data?.repositories ?? [],
    isGitRepo,
    keybindings,
    availableEditors,
    activeThreadId: activeThread.id,
    activeProvider: activeThread.session?.provider ?? activeThread.modelSelection.provider,
    showGitActions,
    diffOpen: resolvedDiffOpen,
    threadAutomations: threadAutomationItems,
    diffDisabledReason,
    diffTotals: repoDiffTotals,
    branchToolbar: branchToolbarProps,
    pinnedMessages,
    pinnedMessageTextById,
    notes: threadNotes,
    activeProjectId,
    projectInstructions,
    canCopyProjectInstructionsToNotes: !isLocalDraftThread,
    onProjectInstructionsChange: setProjectInstructions,
    onCopyProjectInstructionsToNotes: handleCopyProjectInstructionsToNotes,
    onToggleDiff,
    onOpenAutomation: (definition: AutomationDefinition) => onOpenAutomation(definition.id),
    onOpenGithubRepository: openBrowserUrl,
    onJumpToPinnedMessage: handleJumpToPinnedMessage,
    onTogglePinnedMessageDone: handleTogglePinnedMessageDone,
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

  const previewCaps = computerPreviewCardCaps(
    settings.computerPreviewSize === "large" ? "large" : "compact",
  );

  const previewBudgetPx = computerPreviewBudgetPx({
    mainContentWidthPx: mainContentWidth,
    environmentInsetPx: environmentInsetPx,
    caps: previewCaps,
  });

  const previewReservesInset =
    environmentOverlayVariant === "docked" &&
    settings.autoOpenComputerPane &&
    previewSession?.phase === "live" &&
    (previewLayout?.hasFrame === true || previewLayout?.hasVisibleStatus === true) &&
    previewLayout?.floating !== true;

  const previewInsetPx = previewReservesInset
    ? Math.min(previewLayout?.width ?? previewBudgetPx, previewBudgetPx) + 24
    : 0;

  const contentInsetRightPx =
    environmentInsetPx + previewInsetPx > 0 ? environmentInsetPx + previewInsetPx : undefined;

  const environmentHeaderState = environmentEnabled
    ? {
        open: environmentPanelVisible,
        onOpenChange: setEnvironmentPanelOpenPreference,
      }
    : null;

  const showComposerLiveChangesHeader = latestTurnLive && activeTurnLiveDiffState.hasChanges;

  const showComposerActiveTaskListCard = Boolean(activeTaskList && !planSidebarOpen);

  const showComposerWorkflowRunCard = workflowRunState !== null;

  const showComposerSubagentStrip = composerSubagentStripItems.length > 0;

  const showComposerComputerControlEffortHint = shouldShowComputerControlEffortHint({
    enableComputerControl,
    computerControlAvailable,
    dismissed: settings.dismissedComputerControlEffortHint,
    provider: selectedProvider,
    traits: composerTraitSelection,
  });

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
        onOpenSidebar={() => setPlanSidebarOpen(true)}
        attachedToPrevious={attachedToPrevious}
      />
    ) : null;
  return {
    showComposerLiveChangesHeader,
    renderActiveTaskListCard,
    showComposerActiveTaskListCard,
    showComposerSubagentStrip,
    showComposerWorkflowRunCard,

    showComposerComputerControlEffortHint,
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
    previewBudgetPx,
  } as const;
}
