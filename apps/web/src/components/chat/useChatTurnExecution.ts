import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type { ProjectScript } from "@glade/contracts/orchestration/threadEntities";
import type {
  ProviderMentionReference,
  ProviderSkillReference,
} from "@glade/contracts/provider/providerDiscovery";
import { DEFAULT_MODEL_BY_PROVIDER } from "@glade/contracts/provider/model";
import { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderInteractionMode,
  RuntimeMode,
  type ModelSelection,
  type ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import { buildTemporaryWorktreeBranchName } from "@glade/shared/git/git";
import { getDefaultModel } from "@glade/shared/provider/model";
import { providerSupportsNativeTurnSteering } from "@glade/shared/provider/providerMetadata";
import { useCallback } from "react";
import { promoteThreadCreate } from "~/lib/threadCreatePromotion";
import { newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { dispatchThreadNotes } from "~/pinnedMessages";
import {
  mergeProjectInstructionsIntoThreadNotes,
  useProjectInstructionsStore,
} from "~/projectInstructionsStore";
import { dispatchThreadGoal } from "~/threadGoal";
import { collapseExpandedComposerCursor, detectComposerTrigger } from "../../composer-logic";
import { type DraftThreadEnvMode, type QueuedComposerChatTurn } from "../../composerDraftStore";
import {
  cloneComposerImageAttachment,
  stageUploadComposerAttachments,
} from "../../lib/composerSend";
import { queuedComposerDrain } from "../../lib/queuedComposerDrain";
import { clearPendingTurnDispatch } from "../../pendingTurnDispatch";
import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";
import { buildModelSelection } from "../../providerModelOptions";
import { type Thread } from "../../types";
import {
  WorktreeSetupCancelledError,
  createWorktreeSetupResolution,
  resolveQueuedTurnDispatchSettings,
  revokeUserMessagePreviewUrls,
  runWorktreeCreationFlow,
  threadSettingsDispatchFields,
  turnStartDispatchFields,
  type TurnDispatchSettings,
} from "../ChatView.logic";
import type { ChatTurnSubmissionInput } from "./chatSendTypes";
import { waitForSetupScriptTerminalActivity } from "./projectScriptRuntime";
interface PreparedChatTurn {
  nextThreadEnvMode: DraftThreadEnvMode;
  nextThreadBranch: string | null;
  nextThreadWorktreePath: string | null;
  nextAssociatedWorktreePath: string | null;
  nextAssociatedWorktreeBranch: string | null;
  nextAssociatedWorktreeRef: string | null;
  api: NonNullable<ReturnType<typeof readNativeApi>>;
  targetProjectCwdForSend: string;
  threadIdForSend: ThreadId;
  worktreeSetupResolution: ReturnType<typeof createWorktreeSetupResolution> | null;
  baseBranchForWorktree: string | null;
  worktreeCopiesLocalChanges: boolean;
  worktreeSetupScriptName: string | null;
  selectedModelSelectionForSend: ModelSelection;
  selectedModelForSend: string;
  targetProjectDefaultModelSelectionForSend: ModelSelection | null;
  targetProjectIdForSend: ProjectId;
  title: string;
  nextRuntimeModeForSend: RuntimeMode;
  interactionModeForSend: ProviderInteractionMode;
  nextThreadWorkingDirectory: string | null;
  activeThread: Thread;
  targetProjectKindForSend: "project" | "chat";
  setupScriptForWorktree: ProjectScript | null;
  messageCreatedAt: string;
  turnAttachmentsPromise: ReturnType<typeof stageUploadComposerAttachments>;
  messageIdForSend: MessageId;
  providerOptionsForDispatchForSend: ProviderStartOptions | undefined;
  outgoingMessageText: string;
  mentionedSkillsForSend: ProviderSkillReference[];
  mentionedPluginMentionsForSend: ProviderMentionReference[];
  dispatchMode: "queue" | "steer";
  sourceProposedPlanForSend: QueuedComposerChatTurn["sourceProposedPlan"];
  shouldResumeSettledLocalThread: boolean;
  currentActiveGitBranchForSend: string | null;
  queuedChatTurn: QueuedComposerChatTurn | null;
  turnDispatchSettings: TurnDispatchSettings;
  computerControlSequenceForSend: number;
  promptForSend: string;
  composerImagesSnapshot: ChatTurnSubmissionInput["composerImages"];
  composerFilesSnapshot: ChatTurnSubmissionInput["composerFiles"];
  composerAssistantSelectionsSnapshot: ChatTurnSubmissionInput["composerAssistantSelections"];
  composerBrowserAnnotationsSnapshot: ChatTurnSubmissionInput["composerBrowserAnnotations"];
  composerFileCommentsSnapshot: ChatTurnSubmissionInput["composerFileComments"];
  composerTerminalContextsSnapshot: ChatTurnSubmissionInput["composerTerminalContexts"];
  composerPastedTextsSnapshot: ChatTurnSubmissionInput["composerPastedTexts"];
  composerPullRequestContextsSnapshot: ChatTurnSubmissionInput["composerPullRequestContexts"];
  composerSkillsSnapshot: ProviderSkillReference[];
  composerMentionsSnapshot: ProviderMentionReference[];
}
type ChatTurnExecutionInput = Pick<
  ChatTurnSubmissionInput,
  | "isServerThread"
  | "setStoreThreadWorkspace"
  | "clearLocalDispatchWorktreeSetup"
  | "createWorktreeMutation"
  | "beginLocalDispatch"
  | "isLocalDraftThread"
  | "threadNotes"
  | "runProjectScript"
  | "persistThreadSettingsForNextTurn"
  | "rememberCustomBinaryPathForDispatch"
  | "setSettledThreadBranchWarningDismissedThreadId"
  | "armLocalDispatchAckFallback"
  | "setQueuedSteerGate"
  | "threadId"
  | "planSidebarDismissedForTurnRef"
  | "setPlanSidebarOpen"
  | "setRestoredQueuedSourceProposedPlan"
  | "failLocalDispatchWorktreeSetup"
  | "setOptimisticUserMessages"
  | "promptRef"
  | "composerImagesRef"
  | "composerFilesRef"
  | "composerAssistantSelectionsRef"
  | "composerBrowserAnnotationsRef"
  | "composerFileCommentsRef"
  | "composerTerminalContextsRef"
  | "composerPastedTextsRef"
  | "composerPullRequestContextsRef"
  | "setPrompt"
  | "setComposerCursor"
  | "addComposerImagesToDraft"
  | "addComposerFilesToDraft"
  | "addComposerAssistantSelectionToDraft"
  | "addComposerDraftBrowserAnnotations"
  | "addComposerFileCommentToDraft"
  | "addComposerTerminalContextsToDraft"
  | "addComposerPastedTextsToDraft"
  | "addComposerPullRequestContextsToDraft"
  | "updateSelectedComposerSkills"
  | "updateSelectedComposerMentions"
  | "setComposerTrigger"
  | "setThreadError"
  | "sendInFlightRef"
  | "worktreeSetupResolutionRef"
  | "scheduleFailedWorktreeSetupDispatchReset"
  | "resetLocalDispatch"
>;

type ChatTurnExecutionControllerInput = {
  workspace: Pick<
    ChatTurnExecutionInput,
    "isServerThread" | "isLocalDraftThread" | "setSettledThreadBranchWarningDismissedThreadId"
  >;
  session: Pick<
    ChatTurnExecutionInput,
    | "setStoreThreadWorkspace"
    | "createWorktreeMutation"
    | "planSidebarDismissedForTurnRef"
    | "setPlanSidebarOpen"
    | "setRestoredQueuedSourceProposedPlan"
    | "promptRef"
    | "composerImagesRef"
    | "composerFilesRef"
    | "composerAssistantSelectionsRef"
    | "composerBrowserAnnotationsRef"
    | "composerFileCommentsRef"
    | "composerTerminalContextsRef"
    | "composerPastedTextsRef"
    | "composerPullRequestContextsRef"
    | "setPrompt"
    | "setComposerCursor"
    | "addComposerImagesToDraft"
    | "addComposerFilesToDraft"
    | "addComposerAssistantSelectionToDraft"
    | "addComposerDraftBrowserAnnotations"
    | "addComposerFileCommentToDraft"
    | "addComposerTerminalContextsToDraft"
    | "addComposerPastedTextsToDraft"
    | "addComposerPullRequestContextsToDraft"
    | "setComposerTrigger"
    | "sendInFlightRef"
  >;
  provider: Pick<
    ChatTurnExecutionInput,
    | "clearLocalDispatchWorktreeSetup"
    | "beginLocalDispatch"
    | "armLocalDispatchAckFallback"
    | "failLocalDispatchWorktreeSetup"
    | "updateSelectedComposerSkills"
    | "updateSelectedComposerMentions"
    | "worktreeSetupResolutionRef"
    | "scheduleFailedWorktreeSetupDispatchReset"
    | "resetLocalDispatch"
  >;
  transcript: Pick<ChatTurnExecutionInput, "threadNotes" | "setOptimisticUserMessages">;
  environment: Pick<
    ChatTurnExecutionInput,
    "runProjectScript" | "persistThreadSettingsForNextTurn"
  >;
  discovery: Pick<ChatTurnExecutionInput, "rememberCustomBinaryPathForDispatch">;
  turn: Pick<ChatTurnExecutionInput, "setQueuedSteerGate">;
  props: Pick<ChatTurnExecutionInput, "threadId">;
  composer: Pick<ChatTurnExecutionInput, "setThreadError">;
};
export function useChatTurnExecution({
  workspace,
  session,
  provider,
  transcript,
  environment,
  discovery,
  turn,
  props,
  composer,
}: ChatTurnExecutionControllerInput) {
  const { isServerThread, isLocalDraftThread, setSettledThreadBranchWarningDismissedThreadId } =
    workspace;
  const {
    setStoreThreadWorkspace,
    createWorktreeMutation,
    planSidebarDismissedForTurnRef,
    setPlanSidebarOpen,
    setRestoredQueuedSourceProposedPlan,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    composerBrowserAnnotationsRef,
    composerFileCommentsRef,
    composerTerminalContextsRef,
    composerPastedTextsRef,
    composerPullRequestContextsRef,
    setPrompt,
    setComposerCursor,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerDraftBrowserAnnotations,
    addComposerFileCommentToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerPullRequestContextsToDraft,
    setComposerTrigger,
    sendInFlightRef,
  } = session;
  const {
    clearLocalDispatchWorktreeSetup,
    beginLocalDispatch,
    armLocalDispatchAckFallback,
    failLocalDispatchWorktreeSetup,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    worktreeSetupResolutionRef,
    scheduleFailedWorktreeSetupDispatchReset,
    resetLocalDispatch,
  } = provider;
  const { threadNotes, setOptimisticUserMessages } = transcript;
  const { runProjectScript, persistThreadSettingsForNextTurn } = environment;
  const { rememberCustomBinaryPathForDispatch } = discovery;
  const { setQueuedSteerGate } = turn;
  const { threadId } = props;
  const { setThreadError } = composer;
  return useCallback(
    async (preparedTurn: PreparedChatTurn): Promise<boolean> => {
      let {
        nextThreadEnvMode,
        nextThreadBranch,
        nextThreadWorktreePath,
        nextAssociatedWorktreePath,
        nextAssociatedWorktreeBranch,
        nextAssociatedWorktreeRef,
        api,
        targetProjectCwdForSend,
        threadIdForSend,
        worktreeSetupResolution,
        baseBranchForWorktree,
        worktreeCopiesLocalChanges,
        worktreeSetupScriptName,
        selectedModelSelectionForSend,
        selectedModelForSend,
        targetProjectDefaultModelSelectionForSend,
        targetProjectIdForSend,
        title,
        nextRuntimeModeForSend,
        interactionModeForSend,
        nextThreadWorkingDirectory,
        activeThread,
        targetProjectKindForSend,
        setupScriptForWorktree,
        messageCreatedAt,
        turnAttachmentsPromise,
        messageIdForSend,
        outgoingMessageText,
        mentionedSkillsForSend,
        mentionedPluginMentionsForSend,
        dispatchMode,
        sourceProposedPlanForSend,
        shouldResumeSettledLocalThread,
        currentActiveGitBranchForSend,
        queuedChatTurn,
        turnDispatchSettings: preparedTurnDispatchSettings,
        promptForSend,
        composerImagesSnapshot,
        composerFilesSnapshot,
        composerAssistantSelectionsSnapshot,
        composerBrowserAnnotationsSnapshot,
        composerFileCommentsSnapshot,
        composerTerminalContextsSnapshot,
        composerPastedTextsSnapshot,
        composerPullRequestContextsSnapshot,
        composerSkillsSnapshot,
        composerMentionsSnapshot,
      } = preparedTurn;

      const dispatchSettings = resolveQueuedTurnDispatchSettings(
        preparedTurnDispatchSettings,
        queuedChatTurn,
      );
      let createdServerThreadForLocalDraft = false;
      let createdWorktreeForSendPath: string | null = null;
      let switchedToLocalCheckout = false;
      let turnStartSucceeded = false;
      let settledLocalBranchUpdatedForSend = false;
      await (async () => {
        const applyWorkLocallySwitch = async () => {
          switchedToLocalCheckout = true;
          nextThreadEnvMode = "local";
          nextThreadBranch = null;
          nextThreadWorktreePath = null;
          nextAssociatedWorktreePath = null;
          nextAssociatedWorktreeBranch = null;
          nextAssociatedWorktreeRef = null;
          const worktreePathToRemove = createdWorktreeForSendPath;
          createdWorktreeForSendPath = null;
          if (worktreePathToRemove) {
            void api.git
              .removeWorktree({
                cwd: targetProjectCwdForSend,
                path: worktreePathToRemove,
                force: true,
                reclaimTemporaryBranch: true,
              })
              .catch(() => undefined);
          }
          if (isServerThread || createdServerThreadForLocalDraft) {
            await api.orchestration.dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              envMode: "local",
              branch: null,
              worktreePath: null,
              associatedWorktreePath: null,
              associatedWorktreeBranch: null,
              associatedWorktreeRef: null,
            });
            setStoreThreadWorkspace(threadIdForSend, {
              envMode: "local",
              branch: null,
              worktreePath: null,
              associatedWorktreePath: null,
              associatedWorktreeBranch: null,
              associatedWorktreeRef: null,
            });
          }
          clearLocalDispatchWorktreeSetup();
        };

        const consumeWorktreeSetupResolution = async () => {
          const action = worktreeSetupResolution?.action ?? null;
          if (action === null || switchedToLocalCheckout) {
            return;
          }
          if (action === "cancel") {
            throw new WorktreeSetupCancelledError();
          }
          await applyWorkLocallySwitch();
        };

        if (baseBranchForWorktree && worktreeSetupResolution) {
          const worktreeProgressId = randomUUID();
          const creationFlow = await runWorktreeCreationFlow({
            progressId: worktreeProgressId,
            subscribeToProgress: (listener) => api.git.onWorktreeSetupProgress(listener),
            startCreation: () =>
              createWorktreeMutation.mutateAsync({
                cwd: targetProjectCwdForSend,
                ref: baseBranchForWorktree,
                newBranch: buildTemporaryWorktreeBranchName(),
                progressId: worktreeProgressId,
                ...(worktreeCopiesLocalChanges ? { copyChangesFrom: targetProjectCwdForSend } : {}),
              }),
            resolution: worktreeSetupResolution,
            onCreationStep: (stepId) =>
              beginLocalDispatch({
                worktreeSetupStepId: stepId,
                setupScriptName: worktreeSetupScriptName,
                copyLocalChanges: worktreeCopiesLocalChanges,
              }),
            removeWorktree: (worktreePath) =>
              api.git.removeWorktree({
                cwd: targetProjectCwdForSend,
                path: worktreePath,
                force: true,
                reclaimTemporaryBranch: true,
              }),
          });
          if (creationFlow.outcome === "resolved") {
            await consumeWorktreeSetupResolution();
          } else {
            const result = creationFlow.result;
            beginLocalDispatch({
              worktreeSetupStepId: "prepare-thread",
              setupScriptName: worktreeSetupScriptName,
              copyLocalChanges: worktreeCopiesLocalChanges,
            });
            nextThreadBranch = result.worktree.branch;
            nextThreadWorktreePath = result.worktree.path;
            createdWorktreeForSendPath = result.worktree.path;
            const nextAssociatedWorktree = {
              associatedWorktreePath: result.worktree.path,
              associatedWorktreeBranch: result.worktree.branch,
              associatedWorktreeRef: result.worktree.ref,
            };
            nextAssociatedWorktreePath = nextAssociatedWorktree.associatedWorktreePath;
            nextAssociatedWorktreeBranch = nextAssociatedWorktree.associatedWorktreeBranch;
            nextAssociatedWorktreeRef = nextAssociatedWorktree.associatedWorktreeRef;
            if (isServerThread) {
              await api.orchestration.dispatchCommand({
                type: "thread.meta.update",
                commandId: newCommandId(),
                threadId: threadIdForSend,
                envMode: "worktree",
                branch: result.worktree.branch,
                worktreePath: result.worktree.path,
                associatedWorktreePath: nextAssociatedWorktree.associatedWorktreePath,
                associatedWorktreeBranch: nextAssociatedWorktree.associatedWorktreeBranch,
                associatedWorktreeRef: nextAssociatedWorktree.associatedWorktreeRef,
              });

              setStoreThreadWorkspace(threadIdForSend, {
                branch: result.worktree.branch,
                worktreePath: result.worktree.path,
                ...nextAssociatedWorktree,
              });
            }
          }
        }

        const threadCreateModelSelection: ModelSelection = buildModelSelection(
          selectedModelSelectionForSend.provider,
          selectedModelSelectionForSend.model ||
            selectedModelForSend ||
            targetProjectDefaultModelSelectionForSend?.model ||
            getDefaultModel(selectedModelSelectionForSend.provider) ||
            DEFAULT_MODEL_BY_PROVIDER.codex,
          selectedModelSelectionForSend.options,
          selectedModelSelectionForSend.provider === "claudeAgent"
            ? selectedModelSelectionForSend.supportsAutoMode
            : undefined,
        );

        if (isLocalDraftThread) {
          const inheritedProjectInstructions =
            useProjectInstructionsStore.getState().instructionsByProjectId[
              targetProjectIdForSend
            ] ?? "";
          const inheritedThreadNotes = mergeProjectInstructionsIntoThreadNotes({
            threadNotes,
            projectInstructions: inheritedProjectInstructions,
          });
          await promoteThreadCreate(
            {
              type: "thread.create",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              projectId: targetProjectIdForSend,
              title,
              modelSelection: threadCreateModelSelection,
              runtimeMode: nextRuntimeModeForSend,
              interactionMode: interactionModeForSend,
              envMode: nextThreadEnvMode,
              branch: nextThreadBranch,
              worktreePath: nextThreadWorktreePath,
              workingDirectory: nextThreadWorkingDirectory,
              associatedWorktreePath: nextAssociatedWorktreePath,
              associatedWorktreeBranch: nextAssociatedWorktreeBranch,
              associatedWorktreeRef: nextAssociatedWorktreeRef,
              lastKnownPr: activeThread.lastKnownPr ?? null,
              createdAt: activeThread.createdAt,
            },
            api,
          );
          // `thread.create` does not carry notes, so seed the freshly created server thread's notepad with
          // the inherited project instructions via a dedicated meta update. Best-effort: a failure here must
          // not abort the turn.
          if (inheritedThreadNotes !== threadNotes && inheritedThreadNotes.trim().length > 0) {
            try {
              await dispatchThreadNotes(threadIdForSend, inheritedThreadNotes);
            } catch {}
          }

          const draftGoalForSend = activeThread.goal?.trim() ?? "";
          if (draftGoalForSend.length > 0) {
            try {
              await dispatchThreadGoal(threadIdForSend, draftGoalForSend, {
                startBehavior: "defer",
              });
            } catch {}
          }
          if (targetProjectKindForSend === "chat") {
            await api.orchestration.dispatchCommand({
              type: "project.meta.update",
              commandId: newCommandId(),
              projectId: targetProjectIdForSend,
              title,
            });
          }
          createdServerThreadForLocalDraft = true;
        }

        const setupScript = switchedToLocalCheckout ? null : setupScriptForWorktree;
        if (setupScript) {
          let shouldRunSetupScript = false;
          if (isServerThread) {
            shouldRunSetupScript = true;
          } else {
            if (createdServerThreadForLocalDraft) {
              shouldRunSetupScript = true;
            }
          }
          if (shouldRunSetupScript) {
            beginLocalDispatch({
              worktreeSetupStepId: "run-setup-action",
              setupScriptName: setupScript.name,
              copyLocalChanges: worktreeCopiesLocalChanges,
            });
            const setupScriptOptions: Parameters<typeof runProjectScript>[1] = {
              worktreePath: nextThreadWorktreePath,
              rememberAsLastInvoked: false,
              throwOnError: true,
            };
            if (nextThreadWorktreePath) {
              setupScriptOptions.cwd = nextThreadWorktreePath;
            }
            const setupTerminal = await runProjectScript(setupScript, setupScriptOptions);
            if (setupTerminal) {
              const setupActivityAbortController = new AbortController();
              const setupActivityWait = waitForSetupScriptTerminalActivity({
                threadId: threadIdForSend,
                terminalId: setupTerminal.terminalId,
                signal: setupActivityAbortController.signal,
              });

              await (
                worktreeSetupResolution
                  ? Promise.race([setupActivityWait, worktreeSetupResolution.promise])
                  : setupActivityWait
              ).finally(() => setupActivityAbortController.abort());
            }
          }
        }
        // Covers a resolution set while the thread was linked or the setup script ran (the creation-step
        // race above only guards the first step).
        await consumeWorktreeSetupResolution();

        if (isServerThread) {
          await persistThreadSettingsForNextTurn({
            ...threadSettingsDispatchFields(dispatchSettings),
            threadId: threadIdForSend,
            createdAt: messageCreatedAt,
          });
        }

        const stagedTurnAttachments = await turnAttachmentsPromise;

        if (
          isServerThread &&
          activeThread.settledAt != null &&
          nextThreadEnvMode === "local" &&
          nextThreadWorktreePath === null &&
          nextThreadBranch !== activeThread.branch
        ) {
          await api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: threadIdForSend,
            envMode: "local",
            branch: nextThreadBranch,
            worktreePath: null,
            associatedWorktreePath: nextAssociatedWorktreePath,
            associatedWorktreeBranch: nextAssociatedWorktreeBranch,
            associatedWorktreeRef: nextAssociatedWorktreeRef,
          });
          settledLocalBranchUpdatedForSend = true;
          setStoreThreadWorkspace(threadIdForSend, {
            envMode: "local",
            branch: nextThreadBranch,
            worktreePath: null,
            associatedWorktreePath: nextAssociatedWorktreePath,
            associatedWorktreeBranch: nextAssociatedWorktreeBranch,
            associatedWorktreeRef: nextAssociatedWorktreeRef,
          });
        }

        await consumeWorktreeSetupResolution();

        beginLocalDispatch({
          expectedUserMessageId: messageIdForSend,
          ...(baseBranchForWorktree && !switchedToLocalCheckout
            ? {
                worktreeSetupStepId: "start-session" as const,
                setupScriptName: worktreeSetupScriptName,
                copyLocalChanges: worktreeCopiesLocalChanges,
              }
            : {}),
        });
        rememberCustomBinaryPathForDispatch({
          threadId: threadIdForSend,
          provider: dispatchSettings.modelSelection.provider,
          providerOptions: dispatchSettings.providerOptions,
        });
        await stagedTurnAttachments.runWithDispatch(async (turnAttachments) => {
          if (getThreadFromState(useStore.getState(), threadIdForSend)?.claudeCacheReview != null) {
            throw new Error(
              "Choose how to resume the held message before sending another message.",
            );
          }
          await api.orchestration
            .dispatchCommand({
              type: "thread.turn.start",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              message: {
                messageId: messageIdForSend,
                role: "user",
                text: outgoingMessageText,
                attachments: turnAttachments,
                ...(mentionedSkillsForSend.length > 0 ? { skills: mentionedSkillsForSend } : {}),
                ...(mentionedPluginMentionsForSend.length > 0
                  ? { mentions: mentionedPluginMentionsForSend }
                  : {}),
              },
              ...turnStartDispatchFields(dispatchSettings, dispatchMode),
              ...(sourceProposedPlanForSend
                ? { sourceProposedPlan: sourceProposedPlanForSend }
                : {}),
              createdAt: messageCreatedAt,
            })
            .catch((error: unknown) => {
              if (
                getThreadFromState(useStore.getState(), threadIdForSend)?.claudeCacheReview
                  ?.messageId !== messageIdForSend
              ) {
                throw error;
              }
            });
        });
        turnStartSucceeded = true;
        if (
          shouldResumeSettledLocalThread &&
          currentActiveGitBranchForSend !== null &&
          nextThreadBranch === currentActiveGitBranchForSend
        ) {
          setSettledThreadBranchWarningDismissedThreadId(threadIdForSend);
        }
        armLocalDispatchAckFallback(threadIdForSend);
        // Steers on providers without native mid-turn steering interrupt the live turn before
        // re-dispatching; hold queued auto-dispatch through that gap so it can't race the steer. The live
        // session provider decides the interrupt path server-side, so the gate keys off it rather than the
        // requested model selection.
        const liveProviderForSteerGate =
          activeThread?.session?.provider ?? selectedModelSelectionForSend.provider;
        if (
          dispatchMode === "steer" &&
          !providerSupportsNativeTurnSteering(liveProviderForSteerGate)
        ) {
          const nextSteerGate = {
            sawInterruptGap: false,
            gapStartedAt: null,
            armedActiveTurnId: activeThread?.session?.activeTurnId ?? null,
          };
          setQueuedSteerGate(nextSteerGate);
          queuedComposerDrain.armQueuedComposerSteerGate(threadId, nextSteerGate);
        }
        if (sourceProposedPlanForSend) {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        if (queuedChatTurn === null) {
          setRestoredQueuedSourceProposedPlan(threadIdForSend, null);
        }
      })().catch(async (err: unknown) => {
        const setupCancelled = err instanceof WorktreeSetupCancelledError;

        await turnAttachmentsPromise.then(
          (staged) => staged.cleanup(),
          () => undefined,
        );

        if (!setupCancelled) {
          failLocalDispatchWorktreeSetup();
        }
        if (!turnStartSucceeded) {
          clearPendingTurnDispatch(threadIdForSend);
        }
        if (settledLocalBranchUpdatedForSend && !turnStartSucceeded) {
          await api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              envMode: "local",
              branch: activeThread.branch,
              worktreePath: null,
              associatedWorktreePath: activeThread.associatedWorktreePath ?? null,
              associatedWorktreeBranch: activeThread.associatedWorktreeBranch ?? null,
              associatedWorktreeRef: activeThread.associatedWorktreeRef ?? null,
            })
            .then(
              () =>
                setStoreThreadWorkspace(threadIdForSend, {
                  envMode: "local",
                  branch: activeThread.branch,
                  worktreePath: null,
                  associatedWorktreePath: activeThread.associatedWorktreePath ?? null,
                  associatedWorktreeBranch: activeThread.associatedWorktreeBranch ?? null,
                  associatedWorktreeRef: activeThread.associatedWorktreeRef ?? null,
                }),
              () => undefined,
            );
        }
        if (createdServerThreadForLocalDraft && !turnStartSucceeded) {
          await api.orchestration
            .dispatchCommand({
              type: "thread.delete",
              commandId: newCommandId(),
              threadId: threadIdForSend,
            })
            .catch(() => undefined);
        }
        if (createdWorktreeForSendPath && !turnStartSucceeded) {
          const removed = await api.git
            .removeWorktree({
              cwd: targetProjectCwdForSend,
              path: createdWorktreeForSendPath,
              force: true,
              reclaimTemporaryBranch: true,
            })
            .then(
              () => true,
              () => false,
            );
          if (removed && isServerThread) {
            await api.orchestration
              .dispatchCommand({
                type: "thread.meta.update",
                commandId: newCommandId(),
                threadId: threadIdForSend,
                envMode: "local",
                branch: null,
                worktreePath: null,
                associatedWorktreePath: null,
                associatedWorktreeBranch: null,
                associatedWorktreeRef: null,
              })
              .then(
                () =>
                  setStoreThreadWorkspace(threadIdForSend, {
                    branch: null,
                    worktreePath: null,
                    associatedWorktreePath: null,
                    associatedWorktreeBranch: null,
                    associatedWorktreeRef: null,
                  }),
                () => undefined,
              );
          }
        }
        if (queuedChatTurn !== null && !turnStartSucceeded) {
          setOptimisticUserMessages((existing) => {
            const next = existing.filter((message) => message.id !== messageIdForSend);
            return next.length === existing.length ? existing : next;
          });
        }
        if (
          queuedChatTurn === null &&
          !turnStartSucceeded &&
          promptRef.current.length === 0 &&
          composerImagesRef.current.length === 0 &&
          composerFilesRef.current.length === 0 &&
          composerAssistantSelectionsRef.current.length === 0 &&
          composerBrowserAnnotationsRef.current.length === 0 &&
          composerFileCommentsRef.current.length === 0 &&
          composerTerminalContextsRef.current.length === 0 &&
          composerPastedTextsRef.current.length === 0 &&
          composerPullRequestContextsRef.current.length === 0
        ) {
          setOptimisticUserMessages((existing) => {
            const removed = existing.filter((message) => message.id === messageIdForSend);
            for (const message of removed) {
              revokeUserMessagePreviewUrls(message);
            }
            const next = existing.filter((message) => message.id !== messageIdForSend);
            return next.length === existing.length ? existing : next;
          });
          promptRef.current = promptForSend;
          setPrompt(promptForSend);
          if (sourceProposedPlanForSend) {
            setRestoredQueuedSourceProposedPlan(threadIdForSend, {
              threadId: threadIdForSend,
              restoredPrompt: promptForSend,
              sourceProposedPlan: sourceProposedPlanForSend,
            });
          }
          setComposerCursor(collapseExpandedComposerCursor(promptForSend, promptForSend.length));
          addComposerImagesToDraft(composerImagesSnapshot.map(cloneComposerImageAttachment));
          addComposerFilesToDraft(composerFilesSnapshot);
          for (const selection of composerAssistantSelectionsSnapshot) {
            addComposerAssistantSelectionToDraft(selection);
          }
          addComposerDraftBrowserAnnotations(threadIdForSend, composerBrowserAnnotationsSnapshot);
          for (const comment of composerFileCommentsSnapshot) {
            addComposerFileCommentToDraft(comment);
          }
          addComposerTerminalContextsToDraft(composerTerminalContextsSnapshot);
          addComposerPastedTextsToDraft(composerPastedTextsSnapshot);
          addComposerPullRequestContextsToDraft(composerPullRequestContextsSnapshot);
          updateSelectedComposerSkills(composerSkillsSnapshot);
          updateSelectedComposerMentions(composerMentionsSnapshot);
          setComposerTrigger(detectComposerTrigger(promptForSend, promptForSend.length));
        }
        if (!setupCancelled) {
          setThreadError(
            threadIdForSend,
            err instanceof Error ? err.message : "Failed to send message.",
          );
        }
      });
      sendInFlightRef.current = false;
      worktreeSetupResolutionRef.current = null;
      if (!turnStartSucceeded) {
        if (baseBranchForWorktree && (worktreeSetupResolution?.action ?? null) === null) {
          scheduleFailedWorktreeSetupDispatchReset();
        } else {
          resetLocalDispatch();
        }
      }
      return turnStartSucceeded;
    },
    [
      isServerThread,
      setStoreThreadWorkspace,
      clearLocalDispatchWorktreeSetup,
      createWorktreeMutation,
      beginLocalDispatch,
      isLocalDraftThread,
      threadNotes,
      runProjectScript,
      persistThreadSettingsForNextTurn,
      rememberCustomBinaryPathForDispatch,
      setSettledThreadBranchWarningDismissedThreadId,
      armLocalDispatchAckFallback,
      setQueuedSteerGate,
      threadId,
      planSidebarDismissedForTurnRef,
      setPlanSidebarOpen,
      setRestoredQueuedSourceProposedPlan,
      failLocalDispatchWorktreeSetup,
      setOptimisticUserMessages,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerAssistantSelectionsRef,
      composerBrowserAnnotationsRef,
      composerFileCommentsRef,
      composerTerminalContextsRef,
      composerPastedTextsRef,
      composerPullRequestContextsRef,
      setPrompt,
      setComposerCursor,
      addComposerImagesToDraft,
      addComposerFilesToDraft,
      addComposerAssistantSelectionToDraft,
      addComposerDraftBrowserAnnotations,
      addComposerFileCommentToDraft,
      addComposerTerminalContextsToDraft,
      addComposerPastedTextsToDraft,
      addComposerPullRequestContextsToDraft,
      updateSelectedComposerSkills,
      updateSelectedComposerMentions,
      setComposerTrigger,
      setThreadError,
      sendInFlightRef,
      worktreeSetupResolutionRef,
      scheduleFailedWorktreeSetupDispatchReset,
      resetLocalDispatch,
    ],
  );
}
