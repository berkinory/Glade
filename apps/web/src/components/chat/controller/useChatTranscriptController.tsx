import { MessageId, ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { type PendingClaudeCacheReview } from "@glade/contracts/orchestration/threadEntities";
import {
  resolveThreadWorkspaceCwd as resolveSharedThreadWorkspaceCwd,
  resolveThreadBranchSourceCwd,
} from "@glade/shared/threads/threadEnvironment";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS,
  shouldStartActiveTurnLayoutGrace,
} from "../../ChatView.logic.dispatch";
import {
  derivePromptHistoryFromMessages,
  resolveThreadArtifactWorkspaceRoot,
  shouldEnableComposerPastedTextCollapse,
} from "../../ChatView.logic.session";
import { resolveThreadDetailHydration } from "../../ChatView.logic.worktree";
import { type ClaudeCacheReviewDecision } from "~/components/chat/ComposerClaudeCacheReviewPanel";
import { buildTurnDiffSummaryByAssistantMessageId } from "../MessagesTimeline.logic.rowTypes";
import { ThreadDetailHydrationState } from "~/components/chat/ThreadDetailHydrationState";
import { usePinnedMessageActions } from "~/components/chat/environment/usePinnedMessageActions";
import { useChatTimelineMessages } from "~/components/chat/useChatTimelineMessages";
import { useComposerDiscovery } from "~/components/chat/useComposerDiscovery";
import { toastManager } from "~/components/ui/toast";
import {
  hasProviderNativeSlashCommand,
  resolveComposerSlashRootBranch,
} from "~/composerSlashCommands";
import { useClaudeContextCompaction } from "~/hooks/useClaudeContextCompaction";
import { useTurnDiffSummaries } from "~/hooks/useTurnDiffSummaries";
import { gitBranchesQueryOptions, gitStatusQueryOptions } from "../../../lib/gitQueryOptions";
import { getLocalFolderBrowseRootPath } from "~/lib/localFolderMentions";
import { canCreateThreadHandoff } from "~/lib/threadHandoff";
import { isMacNavigatorPlatform, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { mergeProjectInstructionsIntoThreadNotes } from "~/projectPreferencesStore";
import { deriveTimelineEntries } from "../../../workLog.timeline";
import { useStore } from "~/store";
import { buildThreadSubscribeInput } from "~/threadDetailResumeCursors";
import {
  EMPTY_GOAL_ACHIEVEMENTS,
  EMPTY_MESSAGES,
  EMPTY_PINNED_MESSAGES,
  EMPTY_PINNED_TEXT,
} from "./chatViewSupport";
import { useChatThreadContext } from "../ChatThreadContext";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatTranscriptController({
  provider,
  workspace,
  session,
}: {
  provider: ReturnType<typeof useChatProviderController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  session: ReturnType<typeof useChatSessionController>;
}) {
  const {
    activeTurnLayoutLive,
    activePendingApproval,
    isConnecting,
    pendingUserInputs,
    showPlanFollowUpPrompt,
    activePendingProgress,
    isWorking,
    pendingApprovals,
    pendingAutomationConversation,
    agentActivityTimelineState,
    isPendingSetupBubbleId,
    serverConfigQuery,
    selectedProvider,
    providerModelDiscoveryCwd,
    hasLiveTurn,
    activeBackgroundTasks,
    beginLocalDispatch,
    armLocalDispatchAckFallback,
    resetLocalDispatch,
  } = provider;
  const {
    activeThreadId,
    activeLatestTurn,
    activeProject,
    isServerThread,
    projectInstructions,
    activeLatestTurnState,
    latestTurnSettled,
    homeDir,
    isContainerLandingProject,
    resolvedThreadEnvMode,
    resolvedThreadWorktreePath,
    resolvedThreadWorkingDirectory,
  } = workspace;
  const {
    activeThread,
    timelineControllerRef,
    threadDetailSyncState,
    composerTrigger,
    composerCommandPicker,
  } = session;
  const { threadId } = useChatThreadContext();

  const [keepSettledActiveTurnLayout, setKeepSettledActiveTurnLayout] = useState(false);

  const previousActiveTurnLayoutLiveRef = useRef(activeTurnLayoutLive);

  const previousActiveTurnLayoutKeyRef = useRef<string | null>(null);

  const activeTurnLayoutKey =
    activeThreadId === null ? null : `${activeThreadId}:${activeLatestTurn?.turnId ?? "idle"}`;

  const activeTurnInProgress = activeTurnLayoutLive || keepSettledActiveTurnLayout;

  const isComposerApprovalState = activePendingApproval !== null;

  const isComposerEditorDisabled = isConnecting || isComposerApprovalState;

  const canCollapsePastedTextToDraft = shouldEnableComposerPastedTextCollapse({
    isComposerApprovalState,
    hasPendingUserInput: pendingUserInputs.length > 0,
    showPlanFollowUpPrompt,
  });

  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;

  const handoffDisabled = !(
    activeThread &&
    activeProject &&
    isServerThread &&
    canCreateThreadHandoff({
      thread: activeThread,
      isBusy: isWorking,
      hasPendingApprovals: pendingApprovals.length > 0,
      hasPendingUserInput: pendingUserInputs.length > 0,
    })
  );

  useLayoutEffect(() => {
    if (previousActiveTurnLayoutKeyRef.current !== activeTurnLayoutKey) {
      previousActiveTurnLayoutKeyRef.current = activeTurnLayoutKey;
      previousActiveTurnLayoutLiveRef.current = activeTurnLayoutLive;
      setKeepSettledActiveTurnLayout(false);
      return;
    }

    const shouldStartGrace = shouldStartActiveTurnLayoutGrace({
      previousTurnLayoutLive: previousActiveTurnLayoutLiveRef.current,
      currentTurnLayoutLive: activeTurnLayoutLive,
      latestTurnStartedAt: activeLatestTurn?.startedAt ?? null,
    });
    previousActiveTurnLayoutLiveRef.current = activeTurnLayoutLive;

    if (activeTurnLayoutLive) {
      setKeepSettledActiveTurnLayout(false);
      return;
    }

    if (!shouldStartGrace) {
      return;
    }

    setKeepSettledActiveTurnLayout(true);
    const timeoutId = window.setTimeout(() => {
      setKeepSettledActiveTurnLayout(false);
    }, ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    setKeepSettledActiveTurnLayout,
    previousActiveTurnLayoutLiveRef,
    previousActiveTurnLayoutKeyRef,
    activeLatestTurn?.startedAt,
    activeTurnLayoutKey,
    activeTurnLayoutLive,
  ]);

  const { timelineMessages, optimisticUserMessages, setOptimisticUserMessages } =
    useChatTimelineMessages({
      threadId,
      activeThread,
      pendingAutomationConversation,
    });

  const promptHistory = (() => {
    const activeMessages = activeThread?.messages ?? EMPTY_MESSAGES;

    if (optimisticUserMessages.length === 0) {
      return derivePromptHistoryFromMessages(activeMessages);
    }
    const activeMessageIds = new Set(activeMessages.map((message) => message.id));
    const pendingOptimisticMessages = optimisticUserMessages.filter(
      (message) => !activeMessageIds.has(message.id),
    );
    return derivePromptHistoryFromMessages([...activeMessages, ...pendingOptimisticMessages]);
  })();

  const timelineEntries = deriveTimelineEntries(
    timelineMessages,
    activeThread?.proposedPlans ?? [],
    agentActivityTimelineState.timelineWorkEntries,
  );

  const enteringUserMessageIds: ReadonlySet<MessageId> = new Set(
    optimisticUserMessages.map((message) => message.id),
  );

  const [tailAnchor, setTailAnchor] = useState<{
    threadId: ThreadId;
    messageId: MessageId;
  } | null>(null);

  const pinnedMessages = activeThread?.pinnedMessages ?? EMPTY_PINNED_MESSAGES;

  const goalAchievements = activeThread?.goalAchievements ?? EMPTY_GOAL_ACHIEVEMENTS;

  const threadNotes = activeThread?.notes ?? "";

  const pinnedMessageIds = new Set(pinnedMessages.map((pin) => pin.messageId));

  const pinnedMessageTextById = (() => {
    if (pinnedMessageIds.size === 0) return EMPTY_PINNED_TEXT;
    const textById = new Map<MessageId, string>();
    for (const message of timelineMessages) {
      if (pinnedMessageIds.has(message.id)) textById.set(message.id, message.text);
    }
    return textById;
  })();

  const {
    handleTogglePinMessage,
    handleTogglePinnedMessageDone,
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
  } = usePinnedMessageActions({ activeThreadId, pinnedMessages });

  const handleTogglePinMessageGuarded = (messageId: MessageId) => {
    if (isPendingSetupBubbleId(messageId)) {
      return;
    }
    handleTogglePinMessage(messageId);
  };

  const canPinMessage = (messageId: MessageId) => !isPendingSetupBubbleId(messageId);

  const handleCopyProjectInstructionsToNotes = () => {
    if (!activeThreadId) {
      return;
    }
    const nextNotes = mergeProjectInstructionsIntoThreadNotes({
      threadNotes,
      projectInstructions,
    });
    if (nextNotes === threadNotes) {
      return;
    }
    void handleNotesChange(activeThreadId, nextNotes)
      .then(() => {
        toastManager.add({
          type: "success",
          title: "Project instructions added to notepad.",
        });
      })
      .catch(() => {});
  };

  const handleJumpToPinnedMessage = (messageId: MessageId) => {
    timelineControllerRef.current?.scrollToMessage(messageId);
  };

  const threadDetailHydration = resolveThreadDetailHydration({
    isServerThread,
    hasTimelineEntries: timelineEntries.length > 0,
    detailSyncState: threadDetailSyncState,
  });

  // Turn/session updates can arrive before the first transcript row. An empty synced snapshot during
  // startup must not restore the unstarted landing. Terminal turns can lack start timestamps after
  // restore/import; their state wins.
  const hasPendingThreadWork =
    isWorking || (activeLatestTurnState === "running" && !latestTurnSettled);

  const handleRetryThreadDetailSync = () => {
    useStore.getState().clearThreadDetailSyncFailure(threadId);
    const api = readNativeApi();
    void api?.orchestration
      .subscribeThread(buildThreadSubscribeInput(threadId))
      .catch(() => undefined);
  };

  const transcriptEmptyStateContent = ((): ReactNode => {
    if (threadDetailHydration !== "ready") {
      return (
        <ThreadDetailHydrationState
          onRetry={handleRetryThreadDetailSync}
          state={threadDetailHydration}
        />
      );
    }
    return hasPendingThreadWork ? <span aria-hidden="true" /> : undefined;
  })();

  const isCenteredEmptyLanding =
    timelineEntries.length === 0 &&
    !hasPendingThreadWork &&
    !activeThread?.parentThreadId &&
    threadDetailHydration === "ready";

  const isEmptyChatLanding =
    isCenteredEmptyLanding && Boolean(homeDir) && isContainerLandingProject;

  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);

  const turnDiffSummaryByAssistantMessageId = (() => {
    const messagesForDiffAnchoring: {
      id: MessageId;
      role: "user" | "assistant" | "system";
      turnId: TurnId | null;
    }[] = [];
    for (const message of timelineMessages) {
      messagesForDiffAnchoring.push({
        id: message.id,
        role: message.role,
        turnId: message.turnId ?? null,
      });
    }
    return buildTurnDiffSummaryByAssistantMessageId({
      turnDiffSummaries: turnDiffSummaries.map((summary) => ({
        ...summary,
        checkpointTurnCount:
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      })),
      messages: messagesForDiffAnchoring,
    });
  })();

  const threadWorkspaceCwd = activeProject
    ? resolveSharedThreadWorkspaceCwd({
        projectCwd: activeProject.cwd,
        envMode: resolvedThreadEnvMode,
        worktreePath: resolvedThreadWorktreePath,
        workingDirectory: resolvedThreadWorkingDirectory,
      })
    : null;

  const threadArtifactWorkspaceRoot = resolveThreadArtifactWorkspaceRoot({
    projectCwd: activeProject?.cwd ?? null,
    threadWorkspaceCwd,
  });

  const gitCwd = threadWorkspaceCwd;

  const gitBranchSourceCwd = activeProject
    ? resolveThreadBranchSourceCwd({
        projectCwd: activeProject.cwd,
        worktreePath: resolvedThreadWorktreePath,
      })
    : null;

  const branchesQuery = useQuery(gitBranchesQueryOptions(gitBranchSourceCwd));

  const gitStatusQuery = useQuery(gitStatusQueryOptions(gitBranchSourceCwd));

  const localFolderBrowseRootPath = getLocalFolderBrowseRootPath(
    serverConfigQuery.data?.homeDir ?? null,
    isMacNavigatorPlatform(),
  );

  const [isContextWindowMeterOpen, setIsContextWindowMeterOpen] = useState(false);

  const {
    mentionTriggerQuery,
    isLocalFolderBrowserOpen,
    providerPlugins,
    providerNativeCommands,
    providerArtifacts,
    providerSkills,
    workspaceEntries,
    effectiveComposerTrigger,
    effectiveComposerTriggerKind,
    supportsTextNativeReviewCommand,
    isComposerMenuLoading,
    canCompactThread,
    isNativeCommandDiscoveryPending,
  } = useComposerDiscovery({
    threadId,
    selectedProvider,
    composerTrigger,
    composerCommandPicker,
    providerModelDiscoveryCwd,
    gitCwd,
    discoverNativeCompaction:
      selectedProvider === "claudeAgent" &&
      (isContextWindowMeterOpen || activeThread?.claudeCacheReview != null),
  });

  const canRequestNativeClaudeCompaction =
    selectedProvider === "claudeAgent" &&
    hasProviderNativeSlashCommand(
      "claudeAgent",
      providerNativeCommands.map((command) => command.name),
      "compact",
    );

  const claudeCompactDisabledReason = !canRequestNativeClaudeCompaction
    ? isNativeCommandDiscoveryPending
      ? "Checking Claude's available commands..."
      : "Compaction is unavailable for this Claude session."
    : hasLiveTurn || isConnecting || (activeBackgroundTasks?.activeCount ?? 0) > 0
      ? "Wait for Claude and its background tasks to finish."
      : activePendingApproval || pendingUserInputs.length > 0
        ? "Resolve the pending request before compacting."
        : null;

  const standaloneClaudeCompactDisabledReason =
    activeThread?.claudeCacheReview != null
      ? "Choose how to resume the held message above."
      : isWorking
        ? "Wait for Claude to finish before compacting."
        : claudeCompactDisabledReason;

  const { compact: onCompactClaudeContext, isSubmitting: isRequestingClaudeCompaction } =
    useClaudeContextCompaction({
      threadId,
      disabledReason: standaloneClaudeCompactDisabledReason,
      onBegin: beginLocalDispatch,
      onAccepted: armLocalDispatchAckFallback,
      onFailure: resetLocalDispatch,
    });

  const cacheReviewMessageId = activeThread?.claudeCacheReview?.messageId;

  const cacheReviewMessage = cacheReviewMessageId
    ? activeThread?.messages.find((entry) => entry.id === cacheReviewMessageId)
    : undefined;

  const cacheReviewIsCompactionRequest = /^\/compact(?:\s|$)/u.test(
    cacheReviewMessage?.text.trim() ?? "",
  );

  const onRespondToClaudeCacheReview = async (
    review: PendingClaudeCacheReview,
    decision: ClaudeCacheReviewDecision,
  ) => {
    const api = readNativeApi();
    if (!api) throw new Error("Reconnect before choosing how to resume.");
    await api.orchestration.dispatchCommand({
      type: "thread.claude-cache.respond",
      commandId: newCommandId(),
      threadId,
      messageId: review.messageId,
      reviewId: review.reviewId,
      decision,
      createdAt: new Date().toISOString(),
    });
  };

  const activeRootBranch = resolveComposerSlashRootBranch({
    branches: branchesQuery.data?.branches,
    activeProjectCwd: activeProject?.cwd,
    activeThreadBranch: activeThread?.branch,
  });
  return {
    activeTurnInProgress,
    isComposerApprovalState,
    isComposerEditorDisabled,
    canCollapsePastedTextToDraft,
    composerFooterHasWideActions,
    handoffDisabled,
    timelineMessages,
    setOptimisticUserMessages,
    promptHistory,
    timelineEntries,
    enteringUserMessageIds,
    tailAnchor,
    setTailAnchor,
    pinnedMessages,
    goalAchievements,
    threadNotes,
    pinnedMessageIds,
    pinnedMessageTextById,
    handleTogglePinnedMessageDone,
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
    handleTogglePinMessageGuarded,
    canPinMessage,
    handleCopyProjectInstructionsToNotes,
    handleJumpToPinnedMessage,
    threadDetailHydration,
    transcriptEmptyStateContent,
    isCenteredEmptyLanding,
    isEmptyChatLanding,
    turnDiffSummaries,
    turnDiffSummaryByAssistantMessageId,
    threadWorkspaceCwd,
    threadArtifactWorkspaceRoot,
    gitCwd,
    gitBranchSourceCwd,
    branchesQuery,
    gitStatusQuery,
    localFolderBrowseRootPath,
    setIsContextWindowMeterOpen,
    mentionTriggerQuery,
    isLocalFolderBrowserOpen,
    providerPlugins,
    providerNativeCommands,
    providerArtifacts,
    providerSkills,
    workspaceEntries,
    effectiveComposerTrigger,
    effectiveComposerTriggerKind,
    supportsTextNativeReviewCommand,
    isComposerMenuLoading,
    canCompactThread,
    claudeCompactDisabledReason,
    standaloneClaudeCompactDisabledReason,
    onCompactClaudeContext,
    isRequestingClaudeCompaction,
    cacheReviewIsCompactionRequest,
    onRespondToClaudeCacheReview,
    activeRootBranch,
  } as const;
}
