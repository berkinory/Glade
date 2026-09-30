import { MessageId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { resolveComputerInvocationMode } from "@glade/shared/computer/computerInvocation";
import { resolveLatestTailUserMessageEditTarget } from "@glade/shared/threads/conversationEdit";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { deriveAgentActivityTimelineState } from "~/components/chat/agentActivity.logic";
import { useChatAutomationSetup } from "~/components/chat/useChatAutomationSetup";
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
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  type ActiveTaskListState,
} from "~/session-logic";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { ChatViewProps } from "./chatViewSupport";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatProviderController({
  props,
  session,
  workspace,
}: {
  props: ChatViewProps;
  session: ReturnType<typeof useChatSessionController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
}) {
  const { threadId } = props;
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
    planSidebarOpen,
    setComposerDraftPrompt,
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
    interactionMode,
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

  const [openAgentActivityId, setOpenAgentActivityId] = useState<string | null>(null);

  const agentActivityTimelineState = useMemo(
    () => deriveAgentActivityTimelineState(workLogEntries),
    [workLogEntries],
  );

  const openAgentActivityDetail = openAgentActivityId
    ? (agentActivityTimelineState.detailById.get(openAgentActivityId) ?? null)
    : null;

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setOpenAgentActivityId(null);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setOpenAgentActivityId, activeThread?.id]);

  useEffect(() => {
    if (!openAgentActivityId || agentActivityTimelineState.detailById.has(openAgentActivityId)) {
      return;
    }

    const settle = window.setTimeout(() => {
      setOpenAgentActivityId(null);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setOpenAgentActivityId, agentActivityTimelineState.detailById, openAgentActivityId]);

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

  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);

  const sidebarPlanSourceThreadId = !latestTurnSettled
    ? (activeLatestTurn?.sourceProposedPlan?.threadId ?? null)
    : null;

  const sidebarPlanSourceThread = useStore(
    useMemo(() => createThreadSelector(sidebarPlanSourceThreadId), [sidebarPlanSourceThreadId]),
  );

  const activeThreadPlanThreadId = activeThread?.id ?? null;

  const activeThreadPlanProposedPlans = activeThread?.proposedPlans;

  const sidebarPlanSourceThreadPlanId = sidebarPlanSourceThread?.id ?? null;

  const sidebarPlanSourceThreadProposedPlans = sidebarPlanSourceThread?.proposedPlans;

  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: [
          ...(activeThreadPlanThreadId
            ? [
                {
                  id: activeThreadPlanThreadId,
                  proposedPlans: activeThreadPlanProposedPlans ?? [],
                },
              ]
            : []),
          ...(sidebarPlanSourceThreadPlanId &&
          sidebarPlanSourceThreadPlanId !== activeThreadPlanThreadId
            ? [
                {
                  id: sidebarPlanSourceThreadPlanId,
                  proposedPlans: sidebarPlanSourceThreadProposedPlans ?? [],
                },
              ]
            : []),
        ],
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThreadPlanThreadId,
      }),
    [
      activeLatestTurn,
      activeThreadPlanProposedPlans,
      activeThreadPlanThreadId,
      latestTurnSettled,
      sidebarPlanSourceThreadPlanId,
      sidebarPlanSourceThreadProposedPlans,
    ],
  );

  const planSidebarLabel = sidebarProposedPlan ? "Plan details" : "Tasks";

  const planSidebarToggleLabel = planSidebarOpen ? `Hide ${planSidebarLabel}` : planSidebarLabel;

  const planSidebarToggleTitle = `${planSidebarOpen ? "Hide" : "Show"} ${planSidebarLabel.toLowerCase()} sidebar`;

  const activeTaskList = useMemo((): ActiveTaskListState | null => {
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
  }, [activeLatestTurn?.turnId, latestTurnSettled, showDebugTaskBanner, threadActivities]);

  const activeBackgroundTasks = useMemo(
    () =>
      latestTurnSettled
        ? null
        : deriveActiveBackgroundTasksState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, latestTurnSettled, threadActivities],
  );

  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);

  const {
    localDispatch,
    setLocalDispatch,
    worktreeSetupResolutionRef,
    worktreeSetupPendingAction,
    setWorktreeSetupPendingAction,
    turnTakenOver,
    isSendBusy,
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

  const editableUserMessageId = useMemo(() => {
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
  }, [activeThread, isServerThread]);

  const hasQueueableLiveTurn = hasLiveTurn && activeThread?.session?.activeTurnId != null;

  const {
    automationProjects,
    automationThreads,
    automationData,
    automationDraftForm,
    setAutomationDraftForm,
    automationDraftWarnings,
    setAutomationDraftWarnings,
    setAutomationDraftWarningContext,
    acknowledgedAutomationWarnings,
    setAcknowledgedAutomationWarnings,
    automationDraftOpen,
    setAutomationDraftOpen,
    setAutomationDraftDialogOpen,
    isAutomationDraftSubmitting,
    setIsAutomationDraftSubmitting,
    automationDraftSubmittingRef,
    pendingAutomationConversation,
    setPendingAutomationConversation,
    activeThreadIdRef,
    pendingAutomationConversationRef,
    hasLiveTurnRef,
    isPendingSetupBubbleId,
    cancelAutomationConversation,
    toggleAutomationWarning,
    updateAutomationDraftForm,
    resetAutomationDraftState,
  } = useChatAutomationSetup({
    threadId,
    hasLiveTurn,
    promptRef,
    setComposerDraftPrompt,
  });

  const isWorking =
    hasLiveTurn || isSendBusy || isConnecting || isRevertingCheckpoint || isAwaitingTurnStart;

  const hasStreamingAssistantText =
    activeThread?.messages.some((message) => message.role === "assistant" && message.streaming) ??
    false;

  const activeTurnLayoutLive = isWorking || !latestTurnSettled;
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
    setOpenAgentActivityId,
    agentActivityTimelineState,
    openAgentActivityDetail,
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
    activeProposedPlan,
    sidebarProposedPlan,
    planSidebarToggleLabel,
    planSidebarToggleTitle,
    activeTaskList,
    activeBackgroundTasks,
    showPlanFollowUpPrompt,
    localDispatch,
    setLocalDispatch,
    worktreeSetupResolutionRef,
    worktreeSetupPendingAction,
    setWorktreeSetupPendingAction,
    turnTakenOver,
    isSendBusy,
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
    automationProjects,
    automationThreads,
    automationData,
    automationDraftForm,
    setAutomationDraftForm,
    automationDraftWarnings,
    setAutomationDraftWarnings,
    setAutomationDraftWarningContext,
    acknowledgedAutomationWarnings,
    setAcknowledgedAutomationWarnings,
    automationDraftOpen,
    setAutomationDraftOpen,
    setAutomationDraftDialogOpen,
    isAutomationDraftSubmitting,
    setIsAutomationDraftSubmitting,
    automationDraftSubmittingRef,
    pendingAutomationConversation,
    setPendingAutomationConversation,
    activeThreadIdRef,
    pendingAutomationConversationRef,
    hasLiveTurnRef,
    isPendingSetupBubbleId,
    cancelAutomationConversation,
    toggleAutomationWarning,
    updateAutomationDraftForm,
    resetAutomationDraftState,
    isWorking,
    hasStreamingAssistantText,
    activeTurnLayoutLive,
  } as const;
}
