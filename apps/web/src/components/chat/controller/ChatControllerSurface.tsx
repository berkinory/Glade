import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import BranchToolbar from "~/components/BranchToolbar";
import { resolveWorkingLabel } from "../../ChatView.logic.dispatch";
import { GladeLogo } from "~/components/GladeLogo";
import TaskListSidebar from "~/components/TaskListSidebar";
import { PullRequestThreadDialog } from "~/components/PullRequestThreadDialog";
import { RenameThreadDialog } from "~/components/RenameThreadDialog";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import TerminalWorkspaceTabs from "~/components/TerminalWorkspaceTabs";
import { AmbientRailSlot } from "~/components/chat/AmbientRailSlot";
import { ChatHeader } from "~/components/chat/ChatHeader";
import { ChatSurfaceHeader } from "~/components/chat/ChatSurfaceHeader";
import { ChatTranscriptPane } from "~/components/chat/ChatTranscriptPane";
import { ComposerSlashStatusDialog } from "~/components/chat/ComposerSlashStatusDialog";
import { ComputerPreviewPopover } from "~/components/chat/ComputerPreviewPopover";
import { ExpandedImageOverlay } from "~/components/chat/ExpandedImageOverlay";
import { ProjectPicker } from "~/components/chat/ProjectPicker";
import { ProviderHandoffDialog } from "~/components/chat/ProviderHandoffDialog";
import { ProviderHealthBanner } from "~/components/chat/ProviderHealthBanner";
import { RateLimitBanner } from "~/components/chat/RateLimitBanner";
import { ChatThreadFindHost } from "~/components/chat/ThreadFindBar";
import { useThreadErrorToast } from "~/components/chat/useThreadErrorToast";
import { TranscriptSelectionActionLayer } from "~/components/chat/TranscriptSelectionActionLayer";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
  CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
} from "~/components/chat/chatHeaderControls";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "~/components/chat/composerPickerStyles";
import { EnvironmentPanel } from "~/components/chat/environment/EnvironmentPanel";
import { SidebarHeaderTrigger } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import {
  selectThreadComputerPreviewLayout,
  selectThreadComputerPreviewSession,
  useComputerStateStore,
} from "~/computerStateStore";
import { stripDiffSearchParams } from "~/diffRouteSearch";
import { startSelectionChat } from "~/lib/selectionChat";
import { cn } from "~/lib/utils";
import { ProjectImportLandingBanner } from "~/projectImport/ProjectImportLandingBanner";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { undoTurnFiles } from "../chatTaskActions";
import { createChatPresentation } from "./chatPresentation";
import { ThreadTerminalDrawer } from "./chatViewSupport";
import { MAX_DISMISSED_PROVIDER_HEALTH_BANNERS } from "./chatViewSupport";
import type { ChatController } from "./useChatController";
export function ChatControllerSurface({ controller }: { controller: ChatController }) {
  const {
    activeThread,
    desktopTopBarTrafficLightGutterClassName,
    desktopTopBarWindowControlsGutterClassName,
    isDragOverComposer,
    hideHeader,
    surfaceMode,
    isFocusedPane,
    onRegisterCommitAndPushTrigger,
    threadFindOpen,
    threadFindFocusNonce,
    setThreadFindOpen,
    handleThreadFindJump,
    threadFindHighlightStore,
    handleThreadFindActiveMatchChange,
    legendListRef,
    timelineControllerRef,
    crossTaskOrigin,
    forkSource,
    handoffSource,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    setPendingFileUndo,
    resolvedTheme,
    settings,
    timestampFormat,
    composerTranscriptInsetPx,
    composerOverlayBottomClearancePx,
    composerOverlayRef,
    pullRequestDialogState,
    taskListSidebarOpen,
    setTaskListSidebarOpen,
    isInactiveSplitPane,
    handleNewThread,
    expandedImage,
    setExpandedImage,
    setDismissedProviderHealthBannerKeys,
    setDismissedRateLimitBannerKey,
  } = controller.session;
  const {
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    pendingProviderHandoff,
    providerHandoffBusy,
    setPendingProviderHandoff,
    confirmProviderHandoff,
  } = controller.actions;
  const {
    activeProjectDisplayName,
    threadBreadcrumbs,
    terminalWorkspaceTerminalTabActive,
    activeProjectScripts,
    activeProject,
    resolvedDiffOpen,
    diffDisabledReason,
    setRenameDialogOpen,
    renameDialogOpen,
    visibleActiveRateLimitStatus,
    terminalWorkspaceOpen,
    terminalState,
    setTerminalWorkspaceTab,
    onRespondToAsyncUserInput,
    closePullRequestDialog,
    handlePreparedPullRequestThread,
    collapseTerminalWorkspace,

    activeContextWindow,
    activeCumulativeCostUsd,
    activeRateLimitStatus,
    isContainerLandingProject,
    runtimeMode,
    diffEnvironmentPending,
    activeRateLimitBannerDismissalKey,
  } = controller.workspace;
  const {
    isCenteredEmptyLanding,
    threadWorkspaceCwd,
    timelineEntries,
    isEmptyChatLanding,
    activeTurnInProgress,
    pinnedMessageIds,
    handleTogglePinMessage,

    enteringUserMessageIds,
    tailAnchor,
    timelineMessages,
    turnDiffSummaryByAssistantMessageId,
    threadArtifactWorkspaceRoot,
    transcriptEmptyStateContent,
    activeRootBranch,
  } = controller.transcript;
  const {
    isGitRepo,
    keybindings,
    availableEditors,
    diffPanelShortcutLabel,
    repoDiffTotals,
    showGitActions,
    chatSplitShortcutLabel,
    onToggleDiff,
    shouldRenderChatPaneContent,
    shouldShowProviderHealthBanner,
    visibleActiveProviderStatus,
    secondaryChromeReady,
    fastModeEnabled,
    activeProviderHealthBannerDismissalKey,
  } = controller.discovery;
  const {
    lastInvokedScriptByProjectId,
    rightDockOpen,
    saveProjectScript,
    updateProjectScript,
    deleteProjectScript,
    tailAnchorScrollInFlightRef,
    isUserScrollDetached,
    onIsAtEndChange,
    onTranscriptNavigate,
    onMessagesScroll,
    onMessagesClickCapture,
    onMessagesMouseUp,
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
    showScrollToBottom,
    onScrollToBottom,
    environmentEnabled,
    terminalDrawerProps,
    environmentPanelVisible,
    envMode,
    envState,
    pendingTranscriptSelectionAction,
    selectionChatEnvMode,
    dismissTranscriptSelectionAction,
    commitTranscriptAssistantSelection,
    closeExpandedImage,
    navigateExpandedImage,
    runProjectScript,
  } = controller.environment;
  const {
    onToggleRightDock,
    onSplitSurface,
    onMaximizeSurface,
    onChangeThreadInSplitPane,
    onOpenTurnDiffPanel,
    threadId,
  } = controller.props;
  const { setThreadError } = controller.composer;
  const navigate = useNavigate();
  const previewSession = useComputerStateStore(selectThreadComputerPreviewSession(threadId));
  const previewLayout = useComputerStateStore(selectThreadComputerPreviewLayout(threadId));
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const [mainContentWidth, setMainContentWidth] = useState(1600);

  useEffect(() => {
    const element = mainContentRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      setMainContentWidth((previous) => (previous === width ? previous : width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (diffEnvironmentPending) return;
      if (onOpenTurnDiffPanel) {
        onOpenTurnDiffPanel(turnId, filePath);
        return;
      }
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, panel: "diff", diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, panel: "diff", diff: "1", diffTurnId: turnId };
        },
      });
    },
    [diffEnvironmentPending, navigate, onOpenTurnDiffPanel, threadId],
  );

  const onNavigateToThread = useCallback(
    (nextThreadId: ThreadId) => {
      void navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
        search: (previous) => stripDiffSearchParams(previous),
      });
    },
    [navigate],
  );

  useThreadErrorToast({
    threadId: activeThread?.id ?? null,
    error: activeThread?.error ?? null,
    onDismiss: () => {
      if (activeThread) setThreadError(activeThread.id, null);
    },
  });

  const dismissActiveProviderHealthBanner = () => {
    if (!activeProviderHealthBannerDismissalKey) return;
    setDismissedProviderHealthBannerKeys((current) =>
      current.includes(activeProviderHealthBannerDismissalKey)
        ? current
        : [activeProviderHealthBannerDismissalKey, ...current].slice(
            0,
            MAX_DISMISSED_PROVIDER_HEALTH_BANNERS,
          ),
    );
  };
  const dismissActiveRateLimitBanner = () => {
    if (activeRateLimitBannerDismissalKey)
      setDismissedRateLimitBannerKey(activeRateLimitBannerDismissalKey);
  };
  const {
    isWorking,
    activeTurnIdForTranscript,
    openAgentActivityDetail,
    isSendBusy,
    hasLiveTurn,
    turnTakenOver,
    isConnecting,
    providerDisplayName,
    activeWorktreeSetup,
    worktreeSetupPendingAction,
    onResolveWorktreeSetup,
    enableComputerControl,
    editableUserMessageId,
    hasStreamingAssistantText,
    setOpenAgentActivityId,
    activeTaskList,
    selectedModel,
    selectedPromptEffort,
    selectedModelSelection,
    providerOptionsForDispatch,
  } = controller.provider;
  const { reportChatActionFailure } = controller.composer;
  const {
    handleSelectProjectForEmptyDraft,
    handleCreateProjectFromPickerPath,
    handleResetWorkspaceToHome,
    handleForkFromMessage,
    handleEnableComputerControlFromDenial,
    onEditUserMessage,
    isSlashStatusDialogOpen,
    setIsSlashStatusDialogOpen,
    contextWindowSelectionStatus,
  } = controller.submission;
  if (!activeThread) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col text-[var(--color-text-foreground-secondary)]",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        {!isElectron && (
          <header className={cn(CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME, "px-3 py-2 md:hidden")}>
            <div className="flex items-center gap-2">
              <SidebarHeaderTrigger className="size-7 shrink-0" />
              <span className="text-ui-lg font-medium text-[var(--color-text-foreground)]">
                Threads
              </span>
            </div>
          </header>
        )}
        {isElectron && (
          <div
            className={cn(
              CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
              "drag-region px-5",
              desktopTopBarTrafficLightGutterClassName,
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <SidebarHeaderNavigationControls />
            <span className="text-ui leading-snug text-muted-foreground/50">No active thread</span>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-ui leading-snug">
              Select a thread or create a new one to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }
  const presentation = createChatPresentation(controller, activeThread, {
    mainContentWidth,
    previewSession,
    previewLayout,
  });
  const {
    activeThreadDisplayTitle,
    environmentHeaderState,
    handleRenameActiveThread,
    showEmptyLandingProjectPicker,
    relocateComposerLeadingControls,
    renderComposerLeadingControls,
    contentInsetRightPx,
    branchToolbarProps,
    environmentPanelProps,
    environmentOverlayVariant,
    previewBudgetPx,
  } = presentation;
  const composerSection = (
    <ChatComposerSurface
      controller={controller}
      presentation={presentation}
      onNavigateToThread={onNavigateToThread}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        CHAT_BACKGROUND_CLASS_NAME,
      )}
      onDragEnter={onComposerDragEnter}
      onDragOver={onComposerDragOver}
      onDragLeave={onComposerDragLeave}
      onDrop={onComposerDrop}
    >
      {}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-50 transition-opacity duration-100",
          "bg-info/8 ring-1 ring-inset ring-info/30",
          isDragOverComposer ? "opacity-100" : "opacity-0",
        )}
      />
      <ChatSurfaceHeader
        hidden={hideHeader}
        className={cn(
          CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
          CHAT_SURFACE_HEADER_PADDING_X_CLASS,
          "flex items-center",
          CHAT_SURFACE_HEADER_HEIGHT_CLASS,
          isElectron && "drag-region",
          desktopTopBarTrafficLightGutterClassName,
          desktopTopBarWindowControlsGutterClassName,
        )}
      >
        <ChatHeader
          activeThreadId={activeThread.id}
          activeThreadTitle={activeThreadDisplayTitle}
          activeProvider={activeThread.session?.provider ?? activeThread.modelSelection.provider}
          activeProjectName={activeProjectDisplayName}
          threadBreadcrumbs={threadBreadcrumbs}
          hideHandoffControls={terminalWorkspaceTerminalTabActive}
          minimalChrome={isCenteredEmptyLanding}
          isGitRepo={isGitRepo}
          openInTarget={threadWorkspaceCwd}
          activeProjectScripts={activeProjectScripts}
          preferredScriptId={
            activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
          }
          keybindings={keybindings}
          availableEditors={availableEditors}
          diffToggleShortcutLabel={diffPanelShortcutLabel}
          gitCwd={threadWorkspaceCwd}
          diffTotals={repoDiffTotals}
          showGitActions={showGitActions}
          diffOpen={resolvedDiffOpen}
          diffDisabledReason={diffDisabledReason}
          rightDockOpen={rightDockOpen}
          {...(onToggleRightDock ? { onToggleRightDock } : {})}
          environment={environmentHeaderState}
          surfaceMode={surfaceMode}
          chatLayoutAction={
            surfaceMode === "single" && onSplitSurface
              ? {
                  kind: "split",
                  label: "Split chat",
                  shortcutLabel: chatSplitShortcutLabel,
                  onClick: onSplitSurface,
                }
              : surfaceMode === "split" && isFocusedPane && onMaximizeSurface
                ? {
                    kind: "maximize",
                    label: "Expand this chat",
                    shortcutLabel: null,
                    onClick: onMaximizeSurface,
                  }
                : null
          }
          changeThreadAction={
            surfaceMode === "split" && isFocusedPane && onChangeThreadInSplitPane
              ? {
                  label: "Change thread",
                  onClick: onChangeThreadInSplitPane,
                }
              : null
          }
          onRunProjectScript={(script) => {
            void runProjectScript(script);
          }}
          onAddProjectScript={saveProjectScript}
          onUpdateProjectScript={updateProjectScript}
          onDeleteProjectScript={deleteProjectScript}
          onToggleDiff={onToggleDiff}
          onRegisterCommitAndPushTrigger={onRegisterCommitAndPushTrigger}
          onNavigateToThread={onNavigateToThread}
          onRenameThread={() => setRenameDialogOpen(true)}
        />
      </ChatSurfaceHeader>

      {}
      {shouldRenderChatPaneContent ? (
        <ChatThreadFindHost
          open={threadFindOpen}
          focusNonce={threadFindFocusNonce}
          timelineEntries={timelineEntries}
          threadId={threadId}
          className={cn(
            terminalWorkspaceTerminalTabActive && "invisible",
            desktopTopBarWindowControlsGutterClassName,
          )}
          onClose={() => setThreadFindOpen(false)}
          onJump={handleThreadFindJump}
          onHighlightChange={threadFindHighlightStore.set}
          onActiveMatchChange={handleThreadFindActiveMatchChange}
        />
      ) : null}

      <RenameThreadDialog
        open={renameDialogOpen}
        currentTitle={activeThread.title}
        onOpenChange={setRenameDialogOpen}
        onSave={handleRenameActiveThread}
      />

      {}
      <ProviderHealthBanner
        status={shouldShowProviderHealthBanner ? visibleActiveProviderStatus : null}
        onDismiss={dismissActiveProviderHealthBanner}
      />
      <RateLimitBanner
        rateLimitStatus={visibleActiveRateLimitStatus}
        onDismiss={dismissActiveRateLimitBanner}
      />
      {terminalWorkspaceOpen ? (
        <TerminalWorkspaceTabs
          activeTab={terminalState.workspaceActiveTab}
          isWorking={isWorking}
          terminalHasRunningActivity={terminalState.runningTerminalIds.length > 0}
          terminalCount={terminalState.terminalIds.length}
          workspaceLayout={terminalState.workspaceLayout}
          onSelectTab={setTerminalWorkspaceTab}
        />
      ) : null}
      {}
      <div ref={mainContentRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            aria-hidden={terminalWorkspaceTerminalTabActive}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              terminalWorkspaceTerminalTabActive ? "pointer-events-none invisible" : "",
            )}
          >
            {shouldRenderChatPaneContent && isCenteredEmptyLanding ? (
              <div
                className={cn(
                  "chat-pane-enter flex min-h-0 flex-1 flex-col",
                  CHAT_COLUMN_GUTTER_CLASS_NAME,
                )}
              >
                {}
                <div className="relative flex min-h-0 flex-1 items-center justify-center">
                  {}
                  <div className="absolute inset-x-0 top-4 flex justify-center px-6 [@media(max-height:620px)]:hidden">
                    <ProjectImportLandingBanner className="w-full max-w-[520px]" />
                  </div>
                  <div
                    className={cn(
                      "flex flex-col items-center gap-4 px-6 text-center select-none",
                      CHAT_COLUMN_FRAME_CLASS_NAME,
                    )}
                  >
                    <GladeLogo aria-label="Glade logo" className="size-10" />
                    <h2
                      data-testid="empty-landing-heading"
                      className="text-[26px] font-normal leading-[1.15] tracking-[-0.015em] text-foreground/95 sm:text-[30px]"
                    >
                      {isEmptyChatLanding ? (
                        "What should we work on?"
                      ) : (
                        <>
                          What should we do in{" "}
                          {showEmptyLandingProjectPicker && activeProject ? (
                            <ProjectPicker
                              align="center"
                              side="bottom"
                              selectionMode="project"
                              selectedProjectId={activeProject.id}
                              selectedWorkspaceRoot={activeProject.cwd}
                              showResetToHome
                              onSelectProject={handleSelectProjectForEmptyDraft}
                              onCreateProjectFromPath={handleCreateProjectFromPickerPath}
                              onResetToHome={handleResetWorkspaceToHome}
                              renderTrigger={
                                <button
                                  type="button"
                                  data-testid="empty-landing-heading-project-trigger"
                                  className="relative cursor-pointer rounded-sm text-inherit transition-colors duration-100 ease-out after:absolute after:inset-x-[0.08em] after:bottom-0 after:border-b-[1.5px] after:border-dotted after:border-current hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
                                >
                                  {activeProjectDisplayName ?? "this folder"}
                                </button>
                              }
                            />
                          ) : (
                            <span className="text-inherit">
                              {activeProjectDisplayName ?? "this folder"}
                            </span>
                          )}
                          ?
                        </>
                      )}
                    </h2>
                  </div>
                </div>
                <div className="w-full shrink-0 pb-3 sm:pb-4">
                  {composerSection}
                  {relocateComposerLeadingControls ? (
                    <div className={CHAT_COLUMN_FRAME_CLASS_NAME}>
                      <div className="flex w-full items-center gap-1">
                        <div className="flex shrink-0 items-center gap-1 pl-1">
                          {renderComposerLeadingControls({ iconOnly: true })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {shouldRenderChatPaneContent && !isCenteredEmptyLanding ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                  <ChatTranscriptPane
                    activeThreadId={activeThread.id}
                    activeTurnId={activeTurnIdForTranscript}
                    agentActivityDetail={openAgentActivityDetail}
                    hasMessages={timelineEntries.length > 0}
                    isWorking={isWorking}
                    workingLabel={resolveWorkingLabel({
                      isSendBusy,
                      turnTakenOver,
                      isConnecting,
                      providerName: providerDisplayName,
                    })}
                    worktreeSetup={activeWorktreeSetup}
                    worktreeSetupPendingAction={worktreeSetupPendingAction}
                    onResolveWorktreeSetup={onResolveWorktreeSetup}
                    activeTurnInProgress={activeTurnInProgress}
                    listRef={legendListRef}
                    timelineControllerRef={timelineControllerRef}
                    findHighlightStore={threadFindHighlightStore}
                    pinnedMessageIds={pinnedMessageIds}
                    onTogglePinMessage={handleTogglePinMessage}
                    onForkFromMessage={handleForkFromMessage}
                    forkProvider={activeThread.modelSelection.provider}
                    enteringUserMessageIds={enteringUserMessageIds}
                    tailAnchorMessageId={
                      tailAnchor !== null && tailAnchor.threadId === activeThread.id
                        ? tailAnchor.messageId
                        : null
                    }
                    tailAnchorScrollInFlightRef={tailAnchorScrollInFlightRef}
                    crossTaskOrigin={crossTaskOrigin}
                    forkSource={forkSource}
                    handoffSource={handoffSource}
                    timelineEntries={timelineEntries}
                    messageChangeSignal={timelineMessages}
                    turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                    onOpenTurnDiff={onOpenTurnDiff}
                    onOpenThread={onNavigateToThread}
                    computerControlEnabled={enableComputerControl}
                    onEnableComputerControl={handleEnableComputerControlFromDenial}
                    onUndoTurnFiles={(turnCounts) => {
                      void undoTurnFiles({
                        thread: activeThread,
                        turnCounts,
                        isReverting: isRevertingCheckpoint,
                        isBusy: hasLiveTurn || isSendBusy || isConnecting,
                        setIsReverting: setIsRevertingCheckpoint,
                        setPendingFileUndo,
                        setThreadError,
                      }).catch(reportChatActionFailure);
                    }}
                    onEditUserMessage={onEditUserMessage}
                    onRespondToAsyncUserInput={onRespondToAsyncUserInput}
                    editableUserMessageId={editableUserMessageId}
                    isRevertingCheckpoint={isRevertingCheckpoint}
                    onExpandTimelineImage={setExpandedImage}
                    followLiveOutput={hasStreamingAssistantText && !isUserScrollDetached}
                    onIsAtEndChange={onIsAtEndChange}
                    onNavigate={onTranscriptNavigate}
                    markdownCwd={threadWorkspaceCwd ?? undefined}
                    resolvedTheme={resolvedTheme}
                    chatFontSizePx={settings.chatFontSizePx}
                    timestampFormat={timestampFormat}
                    workspaceRoot={threadArtifactWorkspaceRoot ?? undefined}
                    keybindings={keybindings}
                    availableEditors={availableEditors}
                    emptyStateContent={transcriptEmptyStateContent}
                    emptyStateProjectName={activeProjectDisplayName}
                    terminalWorkspaceTerminalTabActive={terminalWorkspaceTerminalTabActive}
                    onMessagesScroll={onMessagesScroll}
                    onMessagesClickCapture={onMessagesClickCapture}
                    onMessagesMouseUp={onMessagesMouseUp}
                    onMessagesWheel={onMessagesWheel}
                    onMessagesPointerDown={onMessagesPointerDown}
                    onMessagesPointerUp={onMessagesPointerUp}
                    onMessagesPointerCancel={onMessagesPointerCancel}
                    onMessagesTouchStart={onMessagesTouchStart}
                    onMessagesTouchMove={onMessagesTouchMove}
                    onMessagesTouchEnd={onMessagesTouchEnd}
                    onOpenAgentActivity={setOpenAgentActivityId}
                    onCloseAgentActivityDetail={() => setOpenAgentActivityId(null)}
                    scrollButtonVisible={showScrollToBottom}
                    onScrollToBottom={onScrollToBottom}
                    contentInsetRightPx={contentInsetRightPx}
                    contentInsetBottomPx={composerTranscriptInsetPx}
                    contentInsetBottomClearancePx={composerOverlayBottomClearancePx}
                  />
                </div>

                {}
                <div className="relative z-10 w-full shrink-0">
                  <div
                    ref={composerOverlayRef}
                    className={cn(
                      "pointer-events-none absolute inset-x-0 bottom-full w-full overflow-visible",
                      ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
                      CHAT_COLUMN_GUTTER_CLASS_NAME,
                    )}
                    style={contentInsetRightPx ? { paddingRight: contentInsetRightPx } : undefined}
                  >
                    <div className="pointer-events-auto">{composerSection}</div>
                  </div>
                  {/* A trailing BranchToolbar only renders for legacy git threads; otherwise the composer is the last
   element, so give it a comfortable bottom margin. */}
                  <div
                    className={cn(isGitRepo && !environmentEnabled ? "pt-0.5" : "pt-3 sm:pt-4")}
                  />
                  {secondaryChromeReady &&
                  ((isGitRepo && !environmentEnabled) || relocateComposerLeadingControls) ? (
                    <div className={CHAT_COLUMN_GUTTER_CLASS_NAME}>
                      <div className={CHAT_COLUMN_FRAME_CLASS_NAME}>
                        <div className="flex w-full items-center gap-1">
                          {relocateComposerLeadingControls ? (
                            <div className="flex shrink-0 items-center gap-1 pl-1">
                              {renderComposerLeadingControls({ iconOnly: true })}
                            </div>
                          ) : null}
                          {isGitRepo && !environmentEnabled ? (
                            <BranchToolbar {...branchToolbarProps} className="min-w-0 flex-1" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {shouldRenderChatPaneContent && secondaryChromeReady && pullRequestDialogState ? (
              <PullRequestThreadDialog
                key={pullRequestDialogState.key}
                open
                cwd={threadArtifactWorkspaceRoot}
                initialReference={pullRequestDialogState.initialReference}
                onOpenChange={(open) => {
                  if (!open) {
                    closePullRequestDialog();
                  }
                }}
                onPrepared={handlePreparedPullRequestThread}
              />
            ) : null}
          </div>

          {terminalWorkspaceOpen ? (
            <div
              aria-hidden={!terminalWorkspaceTerminalTabActive}
              className={cn(
                "absolute inset-0 min-h-0 min-w-0 transition-[opacity,transform] duration-120 ease-out motion-reduce:transition-none",
                terminalWorkspaceTerminalTabActive
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-1 opacity-0",
              )}
            >
              <Suspense fallback={null}>
                <ThreadTerminalDrawer
                  key={`${activeThread.id}-workspace`}
                  {...terminalDrawerProps}
                  presentationMode="workspace"
                  isVisible={terminalWorkspaceTerminalTabActive}
                  onTogglePresentationMode={
                    terminalState.workspaceLayout === "both" ? collapseTerminalWorkspace : undefined
                  }
                />
              </Suspense>
            </div>
          ) : null}

          {}
          {environmentEnabled ? (
            <EnvironmentPanel
              {...environmentPanelProps}
              open={environmentPanelVisible}
              variant={environmentOverlayVariant}
              railBottom={
                previewSession ? (
                  <AmbientRailSlot envOpen={environmentPanelVisible}>
                    <ComputerPreviewPopover
                      key={threadId}
                      threadId={threadId}
                      maxWidthPx={previewBudgetPx}
                      size={settings.computerPreviewSize === "large" ? "large" : "compact"}
                    />
                  </AmbientRailSlot>
                ) : undefined
              }
            />
          ) : null}
        </div>
        {}

        {}
        {taskListSidebarOpen ? (
          <TaskListSidebar
            activeTaskList={activeTaskList}
            timestampFormat={timestampFormat}
            onClose={() => setTaskListSidebarOpen(false)}
          />
        ) : null}
      </div>
      {}

      <ComposerSlashStatusDialog
        open={isSlashStatusDialogOpen}
        onOpenChange={setIsSlashStatusDialogOpen}
        selectedModel={selectedModel}
        fastModeEnabled={fastModeEnabled}
        selectedPromptEffort={selectedPromptEffort}
        envMode={envMode}
        envState={envState}
        branch={activeThread?.branch ?? activeRootBranch}
        contextWindow={activeContextWindow}
        cumulativeCostUsd={activeCumulativeCostUsd}
        rateLimitStatus={activeRateLimitStatus}
        activeContextWindowLabel={contextWindowSelectionStatus.activeLabel}
        pendingContextWindowLabel={contextWindowSelectionStatus.pendingSelectedLabel}
      />
      <ProviderHandoffDialog
        provider={pendingProviderHandoff?.modelSelection.provider ?? null}
        model={pendingProviderHandoff?.modelSelection.model ?? null}
        busy={providerHandoffBusy}
        onOpenChange={(open) => {
          if (!open && !providerHandoffBusy) setPendingProviderHandoff(null);
        }}
        onConfirm={() => void confirmProviderHandoff()}
      />
      {!isInactiveSplitPane && activeProject ? (
        <TranscriptSelectionActionLayer
          key={threadId}
          action={pendingTranscriptSelectionAction}
          defaultEnvMode={selectionChatEnvMode ?? settings.defaultThreadEnvMode}
          canUseWorktree={isGitRepo && !isContainerLandingProject}
          onDismiss={dismissTranscriptSelectionAction}
          onAddToChat={commitTranscriptAssistantSelection}
          onNewChat={(selection, prompt, envMode, intent) =>
            startSelectionChat({
              selection,
              prompt,
              envMode,
              intent,
              projectId: activeProject.id,
              projectCwd: activeProject.cwd,
              modelSelection: selectedModelSelection,
              selectedPromptEffort,
              providerOptionsForDispatch,
              runtimeMode,
              createThread: handleNewThread,
            })
          }
        />
      ) : null}
      <ExpandedImageOverlay
        expandedImage={expandedImage}
        onClose={closeExpandedImage}
        onNavigate={navigateExpandedImage}
      />
    </div>
  );
}
