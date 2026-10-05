import { MessageId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { resolveComputerInvocationMode } from "@glade/shared/computer/computerInvocation";
import { resolveLatestTailUserMessageEditTarget } from "@glade/shared/threads/conversationEdit";
import { useQuery } from "@tanstack/react-query";
import { useRef, useLayoutEffect } from "react";
import { deriveAgentActivityTimelineState } from "~/components/chat/agentActivity.logic";
import { useChatLocalDispatch } from "~/components/chat/useChatLocalDispatch";
import { useChatPendingInteractions } from "~/components/chat/useChatPendingInteractions";
import { useChatProviderModels } from "~/components/chat/useChatProviderModels";
import { useChatWorkLog } from "~/components/chat/useChatWorkLog";
import { useComposerReferences } from "~/components/chat/useComposerReferences";
import { useFeatureFlags } from "~/featureFlags";
import { serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import {
  deriveActiveBackgroundTasksState,
  deriveActiveTaskListState,
  derivePhase,
  type ActiveTaskListState,
} from "~/session-logic";

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
    isComposerModelEffortPickerOpen,
    prompt,
    composerSkills,
    composerMentions,
    promptRef,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,

    isRevertingCheckpoint,
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
    isModelPickerOpen: isComposerModelEffortPickerOpen,
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

  const computerControlMode = resolveComputerInvocationMode({
    messageText: prompt,
    enableComputerControl: settings.computerControlEnabled,
  });

  const enableComputerControl = computerControlMode !== "off";

  const featureFlags = useFeatureFlags();

  const showDebugTaskBanner = import.meta.env.DEV && featureFlags["show-debug-task-banner"];

  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const phase = derivePhase(activeThread?.session ?? null);

  // Gateway credential rotation reconnects the runtime after a finished turn. That background
  // maintenance must not reopen the answer or block the composer.
  const isConnecting = phase === "connecting" && activeLatestTurn?.completedAt == null;

  const providerDisplayName =
    PROVIDER_DISPLAY_NAMES[activeThread?.session?.provider ?? selectedProvider];

  const { workLogEntries, composerSubagentStripItems, stripSourceThreadId, workflowRunState } =
    useChatWorkLog({
      activeThread,
      latestTurnSettled,
      latestTurnLive,
    });

  const agentActivityTimelineState = deriveAgentActivityTimelineState(workLogEntries);
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

  const activeTaskList = ((): ActiveTaskListState | null => {
    if (showDebugTaskBanner) {
      return {
        createdAt: new Date().toISOString(),
        turnId: activeLatestTurn?.turnId ?? null,
        tasks: [
          {
            task: "Inspect banner layout without overlapping transcript text",
            status: "inProgress",
          },
          {
            task: "Confirm compact task banner width",
            status: "pending",
          },
          {
            task: "Verify sidebar task controls",
            status: "completed",
          },
        ],
      };
    }

    // Only while a turn is live: deriveActiveTaskListState falls back to the latest unfinished
    // prior-turn list (follow-up turns, reloads mid-turn), but once the thread is idle the card must
    // clear — providers routinely end a turn without marking every task completed, and an unfinished
    // list must not linger forever.
    return latestTurnSettled
      ? null
      : deriveActiveTaskListState(threadActivities, activeLatestTurn?.turnId);
  })();

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
  // fall back to it.
  const activeTurnIdForTranscript = activeThread?.session?.activeTurnId ?? activeLatestTurnId;

  const editableUserMessageId = (() => {
    if (!activeThread || !isServerThread) {
      return null;
    }
    const editTarget = resolveLatestTailUserMessageEditTarget({
      messages: activeThread.messages,
      activeTurnId:
        activeThread.session?.orchestrationStatus === "running"
          ? (activeThread.session.activeTurnId ?? null)
          : null,
    });
    return editTarget.editable ? (editTarget.messageId as MessageId) : null;
  })();

  const activeThreadIdRef = useRef(threadId);
  useLayoutEffect(() => {
    activeThreadIdRef.current = threadId;
  }, [threadId]);

  const hasQueueableLiveTurn = hasLiveTurn && activeThread?.session?.activeTurnId != null;

  const isWorking =
    hasLiveTurn || isSendBusy || isConnecting || isRevertingCheckpoint || isAwaitingTurnStart;

  const hasStreamingAssistantText =
    activeThread?.messages.some((message) => message.role === "assistant" && message.streaming) ??
    false;

  const activeTurnLayoutLive = isWorking || !latestTurnSettled || activeBackgroundTasks !== null;
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
    computerControlMode,
    enableComputerControl,
    serverSettingsQuery,
    phase,
    isConnecting,
    providerDisplayName,
    workLogEntries,
    composerSubagentStripItems,
    stripSourceThreadId,
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

    activeTaskList,
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
    editableUserMessageId,
    hasQueueableLiveTurn,
    activeThreadIdRef,
    isWorking,
    hasStreamingAssistantText,
    activeTurnLayoutLive,
  } as const;
}
