import { MessageId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { collectEditableUserMessageIds } from "@glade/shared/threads/conversationEdit";
import { useQuery } from "@tanstack/react-query";
import { useRef, useLayoutEffect, useMemo } from "react";
import { createAgentActivityTimelineSelector } from "~/components/chat/agentActivity.logic";
import { EMPTY_MESSAGE_ID_SET } from "~/components/chat/timeline/timelineSupport";
import { useChatLocalDispatch } from "~/components/chat/useChatLocalDispatch";
import { useChatPendingInteractions } from "~/components/chat/useChatPendingInteractions";
import { useChatProviderModels } from "~/components/chat/useChatProviderModels";
import { useChatWorkLog } from "~/components/chat/useChatWorkLog";
import { useComposerReferences } from "~/components/chat/useComposerReferences";
import { serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { deriveActiveBackgroundTasksState, derivePhase } from "~/session-logic";

import { useChatThreadContext } from "../ChatThreadContext";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatProviderController({
  session,
  workspace,
}: {
  session: ReturnType<typeof useChatSessionController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
}) {
  const { threadId } = useChatThreadContext();
  const {
    activeThread,
    composerDraft,
    settings,
    isModelPickerOpen,
    prompt,
    composerSkills,
    composerMentions,
    promptRef,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
  } = session;
  const {
    activeProject,
    resolvedThreadWorktreePath,
    activeLatestTurn,
    latestTurnSettled,
    latestTurnLive,
    runtimeMode,
    threadActivities,

    activeLatestTurnId,
    isServerThread,
  } = workspace;

  const {
    lockedProvider,
    serverConfigQuery,
    selectedProvider,
    providerModelDiscoveryCwd,
    modelOptionsByProvider,
    loadingModelProviders,
    discoveryErrorsByProvider,
    runtimeModelsByProvider,
    dynamicAgents,
    selectedProviderRuntimeModelDiscoveryPending,
    composerModelOptions,
    selectedModel,
    selectedRuntimeModel,
    composerProviderState,
    selectedPromptEffort,
    selectedModelSelection,
    providerOptionsForDispatch,
    selectedModelForPickerWithCustomFallback,
    showComposerModelBootstrapSkeleton,
    searchableModelOptions,
  } = useChatProviderModels({
    threadId,
    activeThread,
    activeProject,
    composerDraft,
    settings,
    isModelPickerOpen,
    resolvedThreadWorktreePath,
  });

  const {
    selectedComposerSkills,
    selectedComposerMentions,
    selectedComposerSkillsRef,
    selectedComposerMentionsRef,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
  } = useComposerReferences({
    threadId,
    selectedProvider,
    prompt,
    composerSkills,
    composerMentions,
  });

  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const phase = derivePhase(activeThread?.session ?? null);

  // Gateway credential rotation reconnects the runtime after a finished turn. That background
  // maintenance must not reopen the answer or block the composer.
  const isConnecting = phase === "connecting" && activeLatestTurn?.completedAt == null;

  const providerDisplayName =
    PROVIDER_DISPLAY_NAMES[activeThread?.session?.provider ?? selectedProvider];

  const { workLogEntries, subagentRosterItems, rosterSourceThreadId, workflowRunState } =
    useChatWorkLog({
      activeThread,
      latestTurnSettled,
      latestTurnLive,
    });

  const selectAgentActivityTimeline = useMemo(() => createAgentActivityTimelineSelector(), []);
  const agentActivityTimelineState = selectAgentActivityTimeline(workLogEntries);
  const getAgentActivityDetail = (activityId: string) =>
    agentActivityTimelineState.detailById.get(activityId);

  const {
    respondingRequestKeys,
    pendingApprovals,
    pendingUserInputs,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    expiredQuestionDrafts,
    activePendingUserInput,
    activePendingUserInputKey,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingQuestion,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingApproval,
    onRespondToApproval,
    userInputSubmissionVersion,
    onCancelActivePendingUserInput,
    onToggleActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
  } = useChatPendingInteractions({
    threadId,
    activeThread,
    runtimeMode,
    promptRef,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
  });

  const backgroundIds = activeThread?.backgroundWork?.taskIds;
  const activeBackgroundTasks =
    activeThread?.session?.status === "closed" || activeThread?.session?.status === "error"
      ? null
      : backgroundIds
        ? backgroundIds.length
          ? { activeCount: backgroundIds.length, taskIds: [...backgroundIds] }
          : null
        : deriveActiveBackgroundTasksState(threadActivities, activeLatestTurn?.turnId ?? undefined);

  const {
    localDispatch,
    setWorktreeSetupResolution,
    worktreeSetupPendingAction,
    turnTakenOver,
    isSendBusy,
    dispatchDeliveryState,
    isAwaitingTurnStart,
    activeWorktreeSetup,
    isPreparingWorktree,
    beginLocalDispatch,
    failLocalDispatchWorktreeSetup,
    resetLocalDispatch,
    clearLocalDispatchWorktreeSetup,
    onResolveWorktreeSetup,
    armLocalDispatchAckFallback,
    scheduleFailedWorktreeSetupDispatchReset,
  } = useChatLocalDispatch({
    phase,
    activeLatestTurn,
    activeThread,
    activePendingApproval,
    activePendingUserInput,
  });

  const hasLiveTurn = phase === "running";

  // Providers that clear `activeTurnId` on every terminal event (Claude) would otherwise leave the
  // transcript with no active turn while work is still in progress, collapsing the newest answer into
  // a closed "Worked for" disclosure. The latest turn is the transcript's own notion of "current", so
  // fall back to it — except while a new message is waiting for its turn to start: the settled turn
  // is no longer current then, and treating it as active would briefly unfold it.
  const awaitingNewTurn = (isSendBusy || isAwaitingTurnStart) && latestTurnSettled;
  const activeTurnIdForTranscript =
    activeThread?.session?.activeTurnId ?? (awaitingNewTurn ? null : activeLatestTurnId);

  const editableUserMessageIds: ReadonlySet<MessageId> =
    activeThread && isServerThread
      ? collectEditableUserMessageIds({
          messages: activeThread.messages,
          activeTurnId:
            activeThread.session?.orchestrationStatus === "running"
              ? (activeThread.session.activeTurnId ?? null)
              : null,
        })
      : EMPTY_MESSAGE_ID_SET;

  const activeThreadIdRef = useRef(threadId);
  useLayoutEffect(() => {
    activeThreadIdRef.current = threadId;
  }, [threadId]);

  const hasQueueableLiveTurn = hasLiveTurn && activeThread?.session?.activeTurnId != null;

  const isWorking = hasLiveTurn || isSendBusy || isConnecting || isAwaitingTurnStart;

  const activeTurnLayoutLive = isWorking || !latestTurnSettled || activeBackgroundTasks !== null;
  // The transcript stays at its end while a turn is live and the reader has not scrolled away: new
  // text, tool rows, groups that open on their own and approvals all grow the same live tail.
  const transcriptFollowsLiveTail = activeTurnLayoutLive;
  return {
    lockedProvider,
    serverConfigQuery,
    selectedProvider,
    providerModelDiscoveryCwd,
    modelOptionsByProvider,
    loadingModelProviders,
    discoveryErrorsByProvider,
    runtimeModelsByProvider,
    dynamicAgents,
    selectedProviderRuntimeModelDiscoveryPending,
    composerModelOptions,
    selectedModel,
    selectedRuntimeModel,
    composerProviderState,
    selectedPromptEffort,
    selectedModelSelection,
    providerOptionsForDispatch,
    selectedModelForPickerWithCustomFallback,
    showComposerModelBootstrapSkeleton,
    searchableModelOptions,
    selectedComposerSkills,
    selectedComposerMentions,
    selectedComposerSkillsRef,
    selectedComposerMentionsRef,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    serverSettingsQuery,
    phase,
    isConnecting,
    providerDisplayName,
    workLogEntries,
    subagentRosterItems,
    rosterSourceThreadId,
    workflowRunState,
    getAgentActivityDetail,
    agentActivityTimelineState,
    respondingRequestKeys,
    pendingApprovals,
    pendingUserInputs,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    expiredQuestionDrafts,
    activePendingUserInput,
    activePendingUserInputKey,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingQuestion,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingApproval,
    onRespondToApproval,
    userInputSubmissionVersion,
    onCancelActivePendingUserInput,
    onToggleActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,

    activeBackgroundTasks,

    localDispatch,
    setWorktreeSetupResolution,
    worktreeSetupPendingAction,
    turnTakenOver,
    isSendBusy,
    dispatchDeliveryState,
    activeWorktreeSetup,
    isPreparingWorktree,
    beginLocalDispatch,
    failLocalDispatchWorktreeSetup,
    resetLocalDispatch,
    clearLocalDispatchWorktreeSetup,
    onResolveWorktreeSetup,
    armLocalDispatchAckFallback,
    scheduleFailedWorktreeSetupDispatchReset,
    hasLiveTurn,
    activeTurnIdForTranscript,
    editableUserMessageIds,
    hasQueueableLiveTurn,
    activeThreadIdRef,
    isWorking,
    transcriptFollowsLiveTail,
    activeTurnLayoutLive,
  } as const;
}
