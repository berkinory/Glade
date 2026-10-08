import { MessageId, ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadBranchSourceCwd } from "@glade/shared/threads/threadEnvironment";
import { useQuery } from "@tanstack/react-query";
import { resolveThreadBrowseCwd } from "~/lib/threadEnvironment";
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
import { buildTurnDiffSummaryByAssistantMessageId } from "../MessagesTimeline.logic.rowTypes";
import { ThreadDetailHydrationState } from "~/components/chat/ThreadDetailHydrationState";
import { usePinnedMessageActions } from "~/components/chat/environment/usePinnedMessageActions";
import { useChatTimelineMessages } from "~/components/chat/useChatTimelineMessages";
import { useComposerDiscovery } from "~/components/chat/useComposerDiscovery";
import { toastManager } from "~/components/ui/toast";
import { resolveComposerSlashRootBranch } from "~/composerSlashCommands";
import { useThreadCompaction } from "~/hooks/useThreadCompaction";
import { useTurnDiffSummaries } from "~/hooks/useTurnDiffSummaries";
import { gitBranchesQueryOptions, gitStatusQueryOptions } from "../../../lib/gitQueryOptions";
import { getLocalFolderBrowseRootPath } from "~/lib/localFolderMentions";
import { canCreateThreadHandoff } from "~/lib/threadHandoff";
import { isMacNavigatorPlatform, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { deriveTimelineEntries } from "../../../workLog.timeline";
import { retryThreadDetailSync } from "~/threadDetailSyncRetry";
import { EMPTY_MESSAGES, EMPTY_PINNED_MESSAGES, EMPTY_PINNED_TEXT } from "./chatViewSupport";
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

    activePendingProgress,
    isWorking,
    pendingApprovals,
    agentActivityTimelineState,
    serverConfigQuery,
    selectedProvider,
    providerModelDiscoveryCwd,
  } = provider;
  const {
    activeThreadId,
    activeLatestTurn,
    activeProject,
    isServerThread,
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

  const isNativeSubagent =
    activeThread?.creationSource === "provider_native" ||
    activeThread?.id.startsWith("subagent:") === true;
  const isComposerEditorDisabled =
    isConnecting || isComposerApprovalState || (isNativeSubagent && pendingUserInputs.length === 0);

  const canCollapsePastedTextToDraft = shouldEnableComposerPastedTextCollapse({
    isComposerApprovalState,
    hasPendingUserInput: pendingUserInputs.length > 0,
  });

  const composerFooterHasWideActions = activePendingProgress !== null;

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
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
  } = usePinnedMessageActions({ activeThreadId, pinnedMessages });

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

  const transcriptEmptyStateContent = ((): ReactNode => {
    if (threadDetailHydration !== "ready") {
      return (
        <ThreadDetailHydrationState
          onRetry={() => retryThreadDetailSync(threadId)}
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
    ? resolveThreadBrowseCwd({
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
  } = useComposerDiscovery({
    threadId,
    selectedProvider,
    composerTrigger,
    composerCommandPicker,
    providerModelDiscoveryCwd,
    gitCwd,
    discoverNativeCompaction: selectedProvider === "claudeAgent" && isContextWindowMeterOpen,
  });

  const { compact: onCompactClaudeContext, isSubmitting: isRequestingClaudeCompaction } =
    useThreadCompaction(threadId);

  const [isAbandoningLegacyCacheHold, setIsAbandoningLegacyCacheHold] = useState(false);
  const onAbandonLegacyCacheHold = async () => {
    const review = activeThread?.claudeCacheReview;
    const api = readNativeApi();
    if (!review || !api || isAbandoningLegacyCacheHold) return;
    setIsAbandoningLegacyCacheHold(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.legacy-cache.abandon",
        commandId: newCommandId(),
        threadId,
        reviewId: review.reviewId,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: error instanceof Error ? error.message : "Could not release the held message.",
      });
    } finally {
      setIsAbandoningLegacyCacheHold(false);
    }
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
    isNativeSubagent,
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

    threadNotes,
    pinnedMessageIds,
    pinnedMessageTextById,
    handleUnpinMessage,
    handleRenamePinnedMessage,
    handleNotesChange,
    handleTogglePinMessage,
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
    standaloneClaudeCompactDisabledReason: null,
    onCompactClaudeContext,
    isRequestingClaudeCompaction,
    isAbandoningLegacyCacheHold,
    onAbandonLegacyCacheHold,
    activeRootBranch,
  } as const;
}
