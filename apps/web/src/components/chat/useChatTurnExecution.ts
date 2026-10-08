import { revokeUserMessagePreviewUrls } from "../ChatView.logic.worktree";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isTurnDispatchOutcomeUnknown } from "../../wsTurnDispatch";
import { resolveProviderModelSelection } from "~/lib/providerModelSelection";
import { useChatThreadContext } from "./ChatThreadContext";
import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import type {
  ProviderMentionReference,
  ProviderSkillReference,
} from "@glade/contracts/provider/providerDiscovery";
import { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  RuntimeMode,
  type ModelSelection,
  type ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import { buildTemporaryWorktreeBranchName } from "@glade/shared/git/git";
import { providerSupportsNativeTurnSteering } from "@glade/shared/provider/providerMetadata";
import { useCallback } from "react";
import { promoteThreadCreate } from "~/lib/threadCreatePromotion";
import { newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

import type { DraftThreadEnvMode, QueuedComposerChatTurn } from "../../composerDraftDomain";
import {
  cloneComposerImageAttachment,
  stageUploadComposerAttachments,
} from "../../lib/composerSend";
import { queuedComposerDrain } from "../../lib/queuedComposerDrain";
import { clearPendingTurnDispatch, usePendingTurnDispatchStore } from "../../pendingTurnDispatch";
import { type Thread } from "../../types";
import {
  WorktreeSetupCancelledError,
  createWorktreeSetupResolution,
  runWorktreeCreationFlow,
} from "../ChatView.logic.dispatch";
import {
  resolveQueuedTurnDispatchSettings,
  threadSettingsDispatchFields,
  turnStartDispatchFields,
  type TurnDispatchSettings,
} from "../ChatView.logic.subagents";
import type { ChatTurnSubmissionInput } from "./chatSendTypes";
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
  selectedModelSelectionForSend: ModelSelection;
  selectedModelForSend: string;
  targetProjectDefaultModelSelectionForSend: ModelSelection | null;
  targetProjectIdForSend: ProjectId;
  title: string;
  nextRuntimeModeForSend: RuntimeMode;

  nextThreadWorkingDirectory: string | null;
  activeThread: Thread;
  targetProjectKindForSend: "project" | "chat";
  messageCreatedAt: string;
  turnAttachmentsPromise: ReturnType<typeof stageUploadComposerAttachments>;
  messageIdForSend: MessageId;
  providerOptionsForDispatchForSend: ProviderStartOptions | undefined;
  outgoingMessageText: string;
  mentionedSkillsForSend: ProviderSkillReference[];
  mentionedPluginMentionsForSend: ProviderMentionReference[];
  dispatchMode: "queue" | "steer";

  shouldResumeSettledLocalThread: boolean;
  currentActiveGitBranchForSend: string | null;
  queuedChatTurn: QueuedComposerChatTurn | null;
  turnDispatchSettings: TurnDispatchSettings;
  promptForSend: string;
  composerImagesSnapshot: ChatTurnSubmissionInput["composerImages"];
  composerFilesSnapshot: ChatTurnSubmissionInput["composerFiles"];
  composerAssistantSelectionsSnapshot: ChatTurnSubmissionInput["composerAssistantSelections"];
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
  | "persistThreadSettingsForNextTurn"
  | "rememberCustomBinaryPathForDispatch"
  | "setSettledThreadBranchWarningDismissedThreadId"
  | "armLocalDispatchAckFallback"
  | "setQueuedSteerGate"
  | "threadId"
  | "failLocalDispatchWorktreeSetup"
  | "setOptimisticUserMessages"
  | "setThreadError"
  | "sendInFlightRef"
  | "setWorktreeSetupResolution"
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
    "setStoreThreadWorkspace" | "createWorktreeMutation" | "sendInFlightRef"
  >;
  provider: Pick<
    ChatTurnExecutionInput,
    | "clearLocalDispatchWorktreeSetup"
    | "beginLocalDispatch"
    | "armLocalDispatchAckFallback"
    | "failLocalDispatchWorktreeSetup"
    | "setWorktreeSetupResolution"
    | "scheduleFailedWorktreeSetupDispatchReset"
    | "resetLocalDispatch"
  >;
  transcript: Pick<ChatTurnExecutionInput, "setOptimisticUserMessages">;
  environment: Pick<ChatTurnExecutionInput, "persistThreadSettingsForNextTurn">;
  discovery: Pick<ChatTurnExecutionInput, "rememberCustomBinaryPathForDispatch">;
  turn: Pick<ChatTurnExecutionInput, "setQueuedSteerGate">;
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
  composer,
}: ChatTurnExecutionControllerInput) {
  const { isServerThread, isLocalDraftThread, setSettledThreadBranchWarningDismissedThreadId } =
    workspace;
  const { setStoreThreadWorkspace, createWorktreeMutation, sendInFlightRef } = session;
  const {
    clearLocalDispatchWorktreeSetup,
    beginLocalDispatch,
    armLocalDispatchAckFallback,
    failLocalDispatchWorktreeSetup,
    setWorktreeSetupResolution,
    scheduleFailedWorktreeSetupDispatchReset,
    resetLocalDispatch,
  } = provider;
  const { setOptimisticUserMessages } = transcript;
  const { persistThreadSettingsForNextTurn } = environment;
  const { rememberCustomBinaryPathForDispatch } = discovery;
  const { setQueuedSteerGate } = turn;
  const { threadId } = useChatThreadContext();
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
        selectedModelSelectionForSend,
        targetProjectIdForSend,
        title,
        nextRuntimeModeForSend,

        nextThreadWorkingDirectory,
        activeThread,
        targetProjectKindForSend,
        messageCreatedAt,
        turnAttachmentsPromise,
        messageIdForSend,
        outgoingMessageText,
        mentionedSkillsForSend,
        mentionedPluginMentionsForSend,
        dispatchMode,

        shouldResumeSettledLocalThread,
        currentActiveGitBranchForSend,
        queuedChatTurn,
        turnDispatchSettings: preparedTurnDispatchSettings,
        promptForSend,
        composerImagesSnapshot,
        composerFilesSnapshot,
        composerAssistantSelectionsSnapshot,
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
      const preservesHandoffDraft = Boolean(
        activeThread.handoff?.operationId &&
        activeThread.handoff.bootstrapStatus === "pending" &&
        activeThread.handoff.stage !== "cancelled",
      );
      let turnStartSucceeded = false;
      let appCommandAccepted = false;
      let turnDispatchAttempted = false;
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

        const threadCreateModelSelection = await resolveProviderModelSelection({
          api,
          selection: selectedModelSelectionForSend,
          cwd: targetProjectCwdForSend,
        });

        if (isLocalDraftThread) {
          await promoteThreadCreate(
            {
              type: "thread.create",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              projectId: targetProjectIdForSend,
              title,
              modelSelection: threadCreateModelSelection,
              runtimeMode: nextRuntimeModeForSend,

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
            if (isServerThread || createdServerThreadForLocalDraft) {
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
        // Covers a resolution set while the thread was linked (the creation-step
        // race above only guards the first step).
        await consumeWorktreeSetupResolution();

        if (
          isServerThread &&
          !(
            activeThread.handoff?.operationId &&
            activeThread.handoff.bootstrapStatus === "pending" &&
            activeThread.handoff.stage !== "cancelled"
          )
        ) {
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
                copyLocalChanges: worktreeCopiesLocalChanges,
              }
            : {}),
        });
        rememberCustomBinaryPathForDispatch({
          threadId: threadIdForSend,
          provider: dispatchSettings.modelSelection.provider,
          providerOptions: dispatchSettings.providerOptions,
        });
        turnDispatchAttempted = true;
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: stagedTurnAttachments.attachments,
            ...(mentionedSkillsForSend.length > 0 ? { skills: mentionedSkillsForSend } : {}),
            ...(mentionedPluginMentionsForSend.length > 0
              ? { mentions: mentionedPluginMentionsForSend }
              : {}),
          },
          ...turnStartDispatchFields(dispatchSettings, dispatchMode),
          ...(activeThread.handoff?.operationId &&
          activeThread.handoff.bootstrapStatus === "pending" &&
          activeThread.handoff.stage !== "cancelled"
            ? { handoffOperationId: activeThread.handoff.operationId }
            : {}),

          createdAt: messageCreatedAt,
        });
        appCommandAccepted = true;
        stagedTurnAttachments.commit();
        const operationId = activeThread.handoff?.operationId;
        if (
          operationId &&
          activeThread.handoff?.bootstrapStatus === "pending" &&
          activeThread.handoff.stage !== "cancelled"
        ) {
          const deadline = Date.now() + 120_000;
          while (true) {
            const snapshot = await api.orchestration.getShellSnapshot();
            const current = snapshot.threads.find(
              (thread) => thread.id === threadIdForSend,
            )?.handoff;
            if (
              current?.operationId !== operationId ||
              ["failed", "cancelled", "uncertain"].includes(current.stage ?? "")
            )
              throw new Error(
                current?.stage === "uncertain"
                  ? "Delivery is uncertain. Check the provider session before retrying; your draft is preserved."
                  : (current?.detail ??
                      "Provider transition did not accept the message. Your draft is preserved."),
              );
            if (current.stage === "delivered" && current.deliveryMessageId === messageIdForSend)
              break;
            if (Date.now() >= deadline)
              throw new Error(
                "Provider acceptance is still pending. Your draft is preserved; check the transition before retrying.",
              );
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
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
      })().catch(async (err: unknown) => {
        const setupCancelled = err instanceof WorktreeSetupCancelledError;
        if (turnDispatchAttempted && (appCommandAccepted || isTurnDispatchOutcomeUnknown(err))) {
          setThreadError(
            threadIdForSend,
            err instanceof Error
              ? err.message
              : "Message delivery could not be confirmed. Check this chat before sending again.",
          );
          clearLocalDispatchWorktreeSetup();
          return;
        }

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
          if (removed && (isServerThread || createdServerThreadForLocalDraft)) {
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
        if (queuedChatTurn === null && !turnStartSucceeded && !preservesHandoffDraft) {
          const draftStore = useComposerDraftStore.getState();
          const current = draftStore.draftsByThreadId[threadIdForSend];
          if (!current?.prompt) draftStore.setPrompt(threadIdForSend, promptForSend);

          draftStore.addImages(
            threadIdForSend,
            composerImagesSnapshot
              .filter((image) => !current?.images.some((item) => item.id === image.id))
              .map(cloneComposerImageAttachment),
          );
          draftStore.addFiles(threadIdForSend, composerFilesSnapshot);
          for (const selection of composerAssistantSelectionsSnapshot)
            draftStore.addAssistantSelection(threadIdForSend, selection);
          for (const comment of composerFileCommentsSnapshot)
            draftStore.addFileComment(threadIdForSend, comment);
          draftStore.setTerminalContexts(threadIdForSend, [
            ...composerTerminalContextsSnapshot.filter(
              (context) => !current?.terminalContexts.some((item) => item.id === context.id),
            ),
            ...(current?.terminalContexts ?? []),
          ]);
          draftStore.addPastedTexts(threadIdForSend, composerPastedTextsSnapshot);
          for (const pr of composerPullRequestContextsSnapshot)
            draftStore.addPullRequestContext(threadIdForSend, pr);
          draftStore.setSkills(
            threadIdForSend,
            current?.skills.length ? current.skills : composerSkillsSnapshot,
          );
          draftStore.setMentions(
            threadIdForSend,
            current?.mentions.length ? current.mentions : composerMentionsSnapshot,
          );
          setOptimisticUserMessages((existing) => {
            for (const message of existing) {
              if (message.id === messageIdForSend && message.attachments)
                revokeUserMessagePreviewUrls({
                  ...message,
                  attachments: message.attachments.filter(
                    (attachment) =>
                      attachment.type !== "image" ||
                      !draftStore.draftsByThreadId[threadIdForSend]?.images.some(
                        (image) => image.previewUrl === attachment.previewUrl,
                      ),
                  ),
                });
            }
            return existing.filter((message) => message.id !== messageIdForSend);
          });
        }
        if (!setupCancelled) {
          setThreadError(
            threadIdForSend,
            err instanceof Error ? err.message : "Failed to send message.",
          );
        }
      });
      sendInFlightRef.current = false;
      setWorktreeSetupResolution(threadIdForSend, null);
      if (
        !turnStartSucceeded &&
        !usePendingTurnDispatchStore.getState().deliveryByThreadId[threadIdForSend]
      ) {
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
      persistThreadSettingsForNextTurn,
      rememberCustomBinaryPathForDispatch,
      setSettledThreadBranchWarningDismissedThreadId,
      armLocalDispatchAckFallback,
      setQueuedSteerGate,
      threadId,
      failLocalDispatchWorktreeSetup,
      setOptimisticUserMessages,
      setThreadError,
      sendInFlightRef,
      setWorktreeSetupResolution,
      scheduleFailedWorktreeSetupDispatchReset,
      resetLocalDispatch,
    ],
  );
}
