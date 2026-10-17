import { createEmptyThreadDraft } from "../../composerDraftDomain";
import { usePendingTurnDispatchStore } from "../../pendingTurnDispatch";
import { useCallback } from "react";
import {
  filterPromptProviderMentionReferences,
  filterPromptSkillReferences,
} from "~/lib/composerMentions";
import { resolveProviderSendAvailabilityWithRefresh } from "~/lib/providerAvailability";
import { newMessageId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { resolveFollowUpDispatchMode } from "../../appSettings";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { QueuedComposerChatTurn } from "../../composerDraftDomain";
import { appendAssistantSelectionsToPrompt } from "../../lib/assistantSelections";
import { appendPastedTextsToPrompt } from "../../lib/composerPastedText";
import {
  findPendingBlobComposerAttachments,
  findUnreadableComposerAttachments,
  hydratePendingBlobComposerAttachments,
  readFileAsDataUrl,
  stageUploadComposerAttachments,
} from "../../lib/composerSend";
import { appendFileCommentsToPrompt } from "../../lib/fileComments";
import { appendPullRequestContextsToPrompt } from "../../lib/pullRequestContext";
import { prepareQueuedComposerResumeAfterSend } from "../../lib/queuedComposerDrain";
import { unblockThreadFromClient } from "../../lib/threadUnblock";
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  appendTerminalContextsToPrompt,
} from "../../lib/terminalContext";
import { setPendingUserInputCustomAnswer } from "../../pendingUserInput";

import {
  buildExpiredTerminalContextToastCopy,
  queuedChatTurnDispatchFields,
  resolveQueuedTurnDispatchSettings,
} from "../ChatView.logic.subagents";
import { createWorktreeSetupResolution, deriveComposerSendState } from "../ChatView.logic.dispatch";
import { toastManager } from "../ui/toast";
import type { ChatTurnSubmissionControllerInput } from "./chatSendTypes";
import { prepareChatSendWorkspace } from "./prepareChatSendWorkspace";
import { buildQueuedComposerPreviewText } from "./queuedComposerPreview";
import { useChatTurnExecution } from "./useChatTurnExecution";

type BlockedSendReason = "send-in-flight" | "session-starting" | "no-project";

const BLOCKED_SEND_TOAST_COPY: Record<
  BlockedSendReason,
  { type: "info" | "warning"; title: string; description: string }
> = {
  "send-in-flight": {
    type: "info",
    title: "Still sending your last message",
    description: "Wait for it to show in the chat before sending again.",
  },
  "session-starting": {
    type: "info",
    title: "The session is still starting",
    description: "Send again once it is ready. Your message stays in the composer.",
  },
  "no-project": {
    type: "warning",
    title: "This chat has no project",
    description: "Choose a project for this chat, then send again.",
  },
};

export function useChatTurnSubmission({
  provider,
  turn,
  session,
  environment,
  composer,
  workspace,
  transcript,
  discovery,
}: ChatTurnSubmissionControllerInput) {
  const {
    hasLiveTurn,
    isConnecting,

    hasQueueableLiveTurn,
    isSendBusy,
    setWorktreeSetupResolution,
    beginLocalDispatch,
    activePendingProgress,
    activePendingUserInputKey,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    selectedComposerSkillsRef,
    selectedComposerMentionsRef,
    selectedProvider,
    selectedModel,
    selectedPromptEffort,
    activeThreadIdRef,
  } = provider;
  const { lateComposerSendHandlersRef, setQueuedSteerGate } = turn;
  const {
    activeThread,
    sendPreflightInFlightRef,
    sendInFlightRef,
    setStoreThreadError,
    queryClient,
    setComposerHighlightedItemId,
    settings,
    composerEditorRef,
    promptRef,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerFileComments,
    composerTerminalContexts,
    composerPastedTexts,
    composerPullRequestContexts,

    enqueueQueuedComposerTurn,
    setComposerTrigger,
    clearProjectDraftThreadId,
    setDraftThreadContext,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    clearComposerDraftContent,
    setComposerCursor,
  } = session;
  const { turnDispatchSettings, armTranscriptAutoFollow, tailAnchorScrollInFlightRef } =
    environment;
  const {
    scheduleComposerFocus,
    setThreadError,
    isVoiceTranscribing,
    waitForPendingComposerImages,
  } = composer;
  const {
    activeProject,
    isServerThread,
    chatWorkspaceRoot,
    isHomeChatContainer,
    resolvedThreadWorktreePath,
    isContainerLandingProject,
  } = workspace;
  const { activeRootBranch, gitBranchSourceCwd, setTailAnchor, setOptimisticUserMessages } =
    transcript;
  const {
    refreshProviderStatuses,
    hasNativeUserMessages,
    currentActiveGitBranch,
    providerStatuses,
  } = discovery;
  const executePreparedTurn = useChatTurnExecution({
    workspace,
    session,
    provider,
    transcript,
    environment,
    discovery,
    turn: { setQueuedSteerGate },
    composer,
  });

  const onSend = useCallback(
    async (
      e?: { preventDefault: () => void },
      requestedDispatchMode?: "queue" | "steer",
      queuedTurn?: QueuedComposerChatTurn,
    ): Promise<boolean> => {
      const dispatchMode =
        requestedDispatchMode ??
        resolveFollowUpDispatchMode({
          behavior: settings.followUpBehavior,
          hasLiveTurn,
        });
      e?.preventDefault();
      const api = readNativeApi();
      const lateSendHandlers = lateComposerSendHandlersRef.current;
      if (!api || !lateSendHandlers || !activeThread || isVoiceTranscribing) {
        return false;
      }
      // Queue drains retry on their own; only a person pressing Send with content needs to hear why.
      const notifyBlockedSend = (reason: BlockedSendReason) => {
        const hasComposerContent =
          (composerEditorRef.current?.readSnapshot().value ?? promptRef.current).trim().length >
            0 ||
          composerImages.length > 0 ||
          composerFiles.length > 0;
        if (queuedTurn || !hasComposerContent) return;
        toastManager.add({
          id: `composer-send-blocked:${activeThread.id}`,
          ...BLOCKED_SEND_TOAST_COPY[reason],
        });
      };
      if (isSendBusy || sendPreflightInFlightRef.current || sendInFlightRef.current) {
        notifyBlockedSend("send-in-flight");
        return false;
      }
      if (isConnecting) {
        notifyBlockedSend("session-starting");
        return false;
      }
      const resumeQueueAfterSend =
        !queuedTurn || dispatchMode === "steer"
          ? prepareQueuedComposerResumeAfterSend(activeThread.id)
          : null;
      const pendingDispatch = usePendingTurnDispatchStore.getState();
      if (!pendingDispatch.beginSubmission(activeThread.id)) {
        notifyBlockedSend("send-in-flight");
        return false;
      }
      // Set once the sent text leaves the composer; cleared when the queue or the turn dispatch takes
      // over the failure handling.
      let restoreSentPromptOnExit: (() => void) | null = null;
      try {
        if (!queuedTurn) {
          sendPreflightInFlightRef.current = true;
          await waitForPendingComposerImages();
          sendPreflightInFlightRef.current = false;
          if (activeThreadIdRef.current !== activeThread.id) return false;
        }
        if (activePendingProgress) {
          const activeQuestion = activePendingProgress.activeQuestion;
          const liveComposerSnapshot = composerEditorRef.current?.readSnapshot() ?? null;
          const livePendingAnswerText = liveComposerSnapshot?.value ?? promptRef.current;
          const currentDraftAnswer =
            activePendingUserInputKey && activeQuestion
              ? pendingUserInputAnswersByRequestIdRef.current[activePendingUserInputKey]?.[
                  activeQuestion.id
                ]
              : undefined;
          const answerOverrides =
            activeQuestion && livePendingAnswerText.trim().length > 0
              ? {
                  [activeQuestion.id]: setPendingUserInputCustomAnswer(
                    currentDraftAnswer,
                    livePendingAnswerText,
                  ),
                }
              : undefined;
          if (activePendingUserInputKey && answerOverrides) {
            const nextRequestAnswers = {
              ...pendingUserInputAnswersByRequestIdRef.current[activePendingUserInputKey],
              ...answerOverrides,
            };
            pendingUserInputAnswersByRequestIdRef.current = {
              ...pendingUserInputAnswersByRequestIdRef.current,
              [activePendingUserInputKey]: nextRequestAnswers,
            };
            setPendingUserInputAnswersByRequestId((existing) => ({
              ...existing,
              [activePendingUserInputKey]: nextRequestAnswers,
            }));
          }
          return lateSendHandlers.advanceActivePendingUserInput(answerOverrides);
        }
        const queuedChatTurn = queuedTurn ?? null;
        let dispatchSettings = resolveQueuedTurnDispatchSettings(
          turnDispatchSettings,
          queuedChatTurn,
        );
        if (activeThread.handoff?.stage === "pending")
          dispatchSettings = { ...dispatchSettings, modelSelection: activeThread.modelSelection };
        const liveComposerSnapshot =
          queuedChatTurn === null ? (composerEditorRef.current?.readSnapshot() ?? null) : null;
        let promptForSend =
          queuedChatTurn?.prompt ?? liveComposerSnapshot?.value ?? promptRef.current;
        const consumedDraft = {
          ...(useComposerDraftStore.getState().draftsByThreadId[activeThread.id] ??
            createEmptyThreadDraft()),
          prompt: promptForSend,
        };
        let composerImagesForSend =
          queuedChatTurn?.images ??
          useComposerDraftStore.getState().draftsByThreadId[activeThread.id]?.images ??
          composerImages;

        if (queuedChatTurn === null) {
          const pendingBlobAttachments = findPendingBlobComposerAttachments({
            persistedAttachments:
              useComposerDraftStore.getState().draftsByThreadId[activeThread.id]
                ?.persistedAttachments ?? [],
            images: composerImagesForSend,
          });
          if (pendingBlobAttachments.length > 0) {
            const hydratedPendingImages =
              await hydratePendingBlobComposerAttachments(pendingBlobAttachments);
            if (hydratedPendingImages.length > 0) {
              composerImagesForSend = [...composerImagesForSend, ...hydratedPendingImages];
            }
          }
        }
        const composerFilesForSend = queuedChatTurn?.files ?? composerFiles;
        if (queuedChatTurn === null) {
          const unreadableAttachments = await findUnreadableComposerAttachments([
            ...composerImagesForSend,
            ...composerFilesForSend,
          ]);
          if (unreadableAttachments.length > 0) {
            const draftStore = useComposerDraftStore.getState();
            for (const attachment of unreadableAttachments) {
              if (attachment.type === "image")
                draftStore.removeImage(activeThread.id, attachment.id);
              else draftStore.removeFile(activeThread.id, attachment.id);
            }
            toastManager.add({
              type: "warning",
              title: "Attachments removed",
              description: `${
                unreadableAttachments.length === 1
                  ? `Removed '${unreadableAttachments[0]?.name}'.`
                  : `Removed ${unreadableAttachments.length} attachments.`
              } The source was moved, deleted or changed after attaching. Check your message and send again.`,
            });
            return false;
          }
        }
        const composerAssistantSelectionsForSend =
          queuedChatTurn?.assistantSelections ?? composerAssistantSelections;
        const composerFileCommentsForSend = queuedChatTurn?.fileComments ?? composerFileComments;
        const composerTerminalContextsForSend =
          queuedChatTurn?.terminalContexts ?? composerTerminalContexts;
        const composerPastedTextsForSend = queuedChatTurn?.pastedTexts ?? composerPastedTexts;
        const composerPullRequestContextsForSend =
          queuedChatTurn?.pullRequestContexts ?? composerPullRequestContexts;
        const selectedComposerSkillsForSend =
          queuedChatTurn?.skills ?? selectedComposerSkillsRef.current;
        const selectedComposerMentionsForSend =
          queuedChatTurn?.mentions ?? selectedComposerMentionsRef.current;
        const selectedProviderForSend = queuedChatTurn?.selectedProvider ?? selectedProvider;
        const selectedModelForSend = queuedChatTurn?.selectedModel ?? selectedModel;
        const selectedPromptEffortForSend =
          queuedChatTurn?.selectedPromptEffort ?? selectedPromptEffort;
        const selectedModelSelectionForSend = dispatchSettings.modelSelection;
        const providerOptionsForDispatchForSend = dispatchSettings.providerOptions;
        const runtimeModeForSend = dispatchSettings.runtimeMode;

        const envModeForSend = dispatchSettings.envMode;
        const {
          trimmedPrompt: trimmed,
          sendableTerminalContexts: sendableComposerTerminalContexts,
          expiredTerminalContextCount,
          sendablePastedTexts: sendableComposerPastedTexts,
          sendablePullRequestContexts: sendableComposerPullRequestContexts,
          hasSendableContent,
        } = deriveComposerSendState({
          prompt: promptForSend,
          imageCount: composerImagesForSend.length,
          fileCount: composerFilesForSend.length,
          assistantSelectionCount: composerAssistantSelectionsForSend.length,
          fileCommentCount: composerFileCommentsForSend.length,
          terminalContexts: composerTerminalContextsForSend,
          pastedTexts: composerPastedTextsForSend,
          pullRequestContexts: composerPullRequestContextsForSend,
        });
        let trimmedPromptForSend = trimmed;

        const hasNoStructuredComposerContext =
          composerImagesForSend.length === 0 &&
          composerFilesForSend.length === 0 &&
          composerAssistantSelectionsForSend.length === 0 &&
          composerFileCommentsForSend.length === 0 &&
          sendableComposerTerminalContexts.length === 0 &&
          sendableComposerPastedTexts.length === 0 &&
          selectedComposerMentionsForSend.length === 0;
        const hasPromptOnlySendableContent = hasNoStructuredComposerContext;
        if (hasPromptOnlySendableContent) {
          const handledSlashCommand =
            await lateSendHandlers.handleStandaloneSlashCommand(trimmedPromptForSend);
          if (handledSlashCommand) {
            return true;
          }
        }

        if (!hasSendableContent) {
          if (expiredTerminalContextCount > 0) {
            const toastCopy = buildExpiredTerminalContextToastCopy(
              expiredTerminalContextCount,
              "empty",
            );
            toastManager.add({
              type: "warning",
              title: toastCopy.title,
              description: toastCopy.description,
            });
          }
          return false;
        }
        if (!activeProject) {
          notifyBlockedSend("no-project");
          return false;
        }

        // The sent text leaves the composer before the first send await, so text typed meanwhile
        // starts a fresh draft. Until the queue or the dispatch takes over, an early refusal puts the
        // text back, but only into an empty composer.
        if (queuedChatTurn === null) {
          const sentPrompt = promptForSend;
          const draftStore = useComposerDraftStore.getState();
          if (draftStore.draftsByThreadId[activeThread.id]?.prompt === sentPrompt) {
            draftStore.setPrompt(activeThread.id, "");
            if (activeThreadIdRef.current === activeThread.id) {
              promptRef.current = "";
              setComposerCursor(0);
              setComposerTrigger(null);
            }
            restoreSentPromptOnExit = () => {
              const current = useComposerDraftStore.getState();
              if (!current.draftsByThreadId[activeThread.id]?.prompt) {
                current.setPrompt(activeThread.id, sentPrompt);
              }
            };
          }
        }

        sendPreflightInFlightRef.current = true;
        const sendProviderAvailability = await resolveProviderSendAvailabilityWithRefresh({
          provider: selectedModelSelectionForSend.provider,
          statuses: providerStatuses,
          refreshStatuses: () => refreshProviderStatuses({ silent: true }),
        }).finally(() => {
          sendPreflightInFlightRef.current = false;
        });
        if (!sendProviderAvailability.usable) {
          toastManager.add({
            type: "error",
            title: "Provider unavailable",
            description: sendProviderAvailability.unavailableReason,
          });
          return false;
        }

        if (hasQueueableLiveTurn && dispatchMode === "queue" && queuedChatTurn === null) {
          clearComposerDraftContent(activeThread.id, { consumedDraft, preservePreviewUrls: true });
          restoreSentPromptOnExit = null;
          if (activeThreadIdRef.current === activeThread.id) scheduleComposerFocus();
          const queuedImagesForPersistence = await Promise.all(
            composerImagesForSend.map(async (image) => {
              try {
                return {
                  ...image,
                  previewUrl: await readFileAsDataUrl(image.file),
                };
              } catch {
                return image;
              }
            }),
          );
          enqueueQueuedComposerTurn(activeThread.id, {
            id: randomUUID(),
            kind: "chat",
            createdAt: new Date().toISOString(),
            previewText: buildQueuedComposerPreviewText({
              trimmedPrompt: trimmed,
              images: queuedImagesForPersistence,
              files: composerFilesForSend,
              assistantSelections: composerAssistantSelectionsForSend,
              terminalContexts: sendableComposerTerminalContexts,
              fileComments: composerFileCommentsForSend,
              pastedTexts: sendableComposerPastedTexts,
              pullRequestContexts: sendableComposerPullRequestContexts,
            }),
            prompt: promptForSend,
            images: queuedImagesForPersistence,
            files: composerFilesForSend,
            assistantSelections: composerAssistantSelectionsForSend,
            fileComments: composerFileCommentsForSend,
            terminalContexts: sendableComposerTerminalContexts,
            pastedTexts: sendableComposerPastedTexts,
            pullRequestContexts: sendableComposerPullRequestContexts,
            skills: selectedComposerSkillsForSend,
            mentions: selectedComposerMentionsForSend,
            selectedProvider: selectedProviderForSend,
            selectedModel: selectedModelForSend,
            selectedPromptEffort: selectedPromptEffortForSend,

            ...queuedChatTurnDispatchFields(dispatchSettings),
            envMode: envModeForSend,
          });
          return true;
        }
        if (isServerThread) {
          sendPreflightInFlightRef.current = true;
          try {
            await unblockThreadFromClient(api.orchestration, activeThread.id);
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Could not resume chat",
              description:
                error instanceof Error
                  ? error.message
                  : "An unexpected error occurred while clearing the provider failure.",
            });
            return false;
          } finally {
            sendPreflightInFlightRef.current = false;
          }
          if (activeThreadIdRef.current !== activeThread.id) return false;
        }
        const workspace = await prepareChatSendWorkspace({
          activeThread,
          isServerThread,
          hasNativeUserMessages,
          composerImagesForSend,
          trimmedPromptForSend,
          composerFilesForSend,
          composerAssistantSelectionsForSend,
          sendableComposerTerminalContexts,
          composerFileCommentsForSend,
          sendableComposerPastedTexts,
          selectedModelSelectionForSend,
          selectedModelForSend,
          activeProject,
          chatWorkspaceRoot,
          isHomeChatContainer,
          resolvedThreadWorktreePath,
          runtimeModeForSend,
          envModeForSend,
          copyLocalChangesToWorktree:
            useComposerDraftStore.getState().getDraftThread(activeThread.id)?.copyLocalChanges ??
            true,
          currentActiveGitBranch,
          isContainerLandingProject,
          clearProjectDraftThreadId,
          setDraftThreadContext,
          activeRootBranch,
          gitBranchSourceCwd,
          setStoreThreadError,
          queryClient,
        });
        if (workspace === false) return false;
        const {
          threadIdForSend,
          title,
          targetProjectIdForSend,
          targetProjectKindForSend,
          targetProjectCwdForSend,
          targetProjectDefaultModelSelectionForSend,
          nextRuntimeModeForSend,
          nextThreadEnvMode,
          nextThreadBranch,
          nextThreadWorktreePath,
          nextThreadWorkingDirectory,
          nextAssociatedWorktreePath,
          nextAssociatedWorktreeBranch,
          nextAssociatedWorktreeRef,
          shouldResumeSettledLocalThread,
          currentActiveGitBranchForSend,
          baseBranchForWorktree,
          worktreeCopiesLocalChanges,
        } = workspace;
        const messageIdForSend = newMessageId();
        const worktreeSetupResolution = baseBranchForWorktree
          ? createWorktreeSetupResolution()
          : null;
        setWorktreeSetupResolution(threadIdForSend, worktreeSetupResolution);

        sendInFlightRef.current = true;
        beginLocalDispatch({
          expectedUserMessageId: messageIdForSend,
          ...(baseBranchForWorktree
            ? {
                worktreeSetupStepId: "create-branch" as const,
                copyLocalChanges: worktreeCopiesLocalChanges,
              }
            : {}),
        });

        const composerImagesSnapshot = [...composerImagesForSend];
        const composerFilesSnapshot = [...composerFilesForSend];
        const composerAssistantSelectionsSnapshot = [...composerAssistantSelectionsForSend];
        const composerFileCommentsSnapshot = [...composerFileCommentsForSend];
        const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
        const composerPastedTextsSnapshot = [...sendableComposerPastedTexts];
        const composerPullRequestContextsSnapshot = [...sendableComposerPullRequestContexts];
        const composerSkillsSnapshot = [...selectedComposerSkillsForSend];
        const composerMentionsSnapshot = [...selectedComposerMentionsForSend];

        const messageTextForSend = appendPullRequestContextsToPrompt(
          appendPastedTextsToPrompt(
            appendFileCommentsToPrompt(
              appendTerminalContextsToPrompt(
                appendAssistantSelectionsToPrompt(
                  promptForSend,
                  composerAssistantSelectionsSnapshot,
                ),
                composerTerminalContextsSnapshot,
              ),
              composerFileCommentsSnapshot,
            ),
            composerPastedTextsSnapshot,
          ),
          composerPullRequestContextsSnapshot,
        );
        const messageCreatedAt = new Date().toISOString();
        const outgoingTextSeed =
          messageTextForSend ||
          (composerImagesSnapshot.length > 0 ? IMAGE_ONLY_BOOTSTRAP_PROMPT : "");
        const outgoingMessageText = outgoingTextSeed;
        const mentionedSkillsForSend = filterPromptSkillReferences(
          outgoingMessageText,
          selectedComposerSkillsForSend,
        );
        const mentionedPluginMentionsForSend = filterPromptProviderMentionReferences(
          outgoingMessageText,
          selectedComposerMentionsForSend,
        );
        const turnAttachmentsPromise = stageUploadComposerAttachments({
          threadId: threadIdForSend,
          images: composerImagesSnapshot,
          files: composerFilesSnapshot,
          assistantSelections: composerAssistantSelectionsSnapshot,
        });
        const optimisticAttachments = [
          ...composerAssistantSelectionsSnapshot,
          ...composerImagesSnapshot.map((image) => ({
            type: "image" as const,
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            previewUrl: image.previewUrl,
          })),
          ...composerFilesSnapshot.map((file) => ({
            type: "file" as const,
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
          })),
        ];
        if (activeThreadIdRef.current === threadIdForSend) {
          setOptimisticUserMessages((existing) => [
            ...existing,
            {
              id: messageIdForSend,
              role: "user",
              text: outgoingMessageText,
              dispatchMode,
              ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
              ...(mentionedSkillsForSend.length > 0 ? { skills: mentionedSkillsForSend } : {}),
              ...(mentionedPluginMentionsForSend.length > 0
                ? { mentions: mentionedPluginMentionsForSend }
                : {}),
              createdAt: messageCreatedAt,
              streaming: false,
              source: "native",
            },
          ]);

          armTranscriptAutoFollow(threadIdForSend, true);
          tailAnchorScrollInFlightRef.current = true;
          setTailAnchor({ threadId: threadIdForSend, messageId: messageIdForSend });
        }

        setThreadError(threadIdForSend, null);
        if (expiredTerminalContextCount > 0) {
          const toastCopy = buildExpiredTerminalContextToastCopy(
            expiredTerminalContextCount,
            "omitted",
          );
          toastManager.add({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          });
        }
        // Queued turns send from their captured snapshot and never touch the live draft. From here
        // the turn dispatch restores a failed send, again only into an empty composer.
        const clearSentComposerContent = () => {
          clearComposerDraftContent(threadIdForSend, { preservePreviewUrls: true, consumedDraft });
          if (
            activeThreadIdRef.current === threadIdForSend &&
            !useComposerDraftStore.getState().draftsByThreadId[threadIdForSend]?.prompt
          ) {
            promptHistoryNavigationRef.current = null;
            applyingPromptHistoryNavigationRef.current = false;
            expectedPromptHistoryPromptRef.current = null;
            promptRef.current = "";
            setComposerHighlightedItemId(null);
            setComposerCursor(0);
            setComposerTrigger(null);
            scheduleComposerFocus();
          }
        };
        restoreSentPromptOnExit = null;
        if (queuedChatTurn === null) clearSentComposerContent();

        const accepted = await executePreparedTurn({
          nextThreadEnvMode,
          nextThreadBranch,
          nextThreadWorktreePath,
          nextAssociatedWorktreePath,
          nextAssociatedWorktreeBranch,
          nextAssociatedWorktreeRef,
          turnDispatchSettings: dispatchSettings,
          api: workspace.api,
          targetProjectCwdForSend,
          threadIdForSend,
          worktreeSetupResolution,
          baseBranchForWorktree,
          worktreeCopiesLocalChanges,
          selectedModelSelectionForSend,
          selectedModelForSend,
          targetProjectDefaultModelSelectionForSend,
          targetProjectIdForSend,
          title,
          nextRuntimeModeForSend,

          nextThreadWorkingDirectory,
          activeThread,
          targetProjectKindForSend,
          messageCreatedAt,
          turnAttachmentsPromise,
          messageIdForSend,
          providerOptionsForDispatchForSend,
          outgoingMessageText,
          mentionedSkillsForSend,
          mentionedPluginMentionsForSend,
          dispatchMode,

          shouldResumeSettledLocalThread,
          currentActiveGitBranchForSend,
          queuedChatTurn,
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
        });
        if (accepted) resumeQueueAfterSend?.();
        return accepted;
      } finally {
        restoreSentPromptOnExit?.();
        pendingDispatch.endSubmission(activeThread.id);
        sendPreflightInFlightRef.current = false;
        sendInFlightRef.current = false;
      }
    },
    [
      hasLiveTurn,
      lateComposerSendHandlersRef,
      activeThread,
      isConnecting,
      sendPreflightInFlightRef,
      sendInFlightRef,
      turnDispatchSettings,

      hasQueueableLiveTurn,
      scheduleComposerFocus,
      activeProject,
      refreshProviderStatuses,
      isServerThread,
      hasNativeUserMessages,
      chatWorkspaceRoot,
      isHomeChatContainer,
      resolvedThreadWorktreePath,
      currentActiveGitBranch,
      isContainerLandingProject,
      activeRootBranch,
      gitBranchSourceCwd,
      setStoreThreadError,
      queryClient,
      setTailAnchor,
      setThreadError,
      setComposerHighlightedItemId,
      settings,
      isSendBusy,
      setWorktreeSetupResolution,
      beginLocalDispatch,
      isVoiceTranscribing,
      waitForPendingComposerImages,
      activePendingProgress,
      activePendingUserInputKey,
      pendingUserInputAnswersByRequestIdRef,
      setPendingUserInputAnswersByRequestId,
      composerEditorRef,
      promptRef,
      composerImages,
      composerFiles,
      composerAssistantSelections,
      composerFileComments,
      composerTerminalContexts,
      composerPastedTexts,
      composerPullRequestContexts,

      enqueueQueuedComposerTurn,
      setComposerTrigger,
      clearProjectDraftThreadId,
      setDraftThreadContext,
      promptHistoryNavigationRef,
      applyingPromptHistoryNavigationRef,
      expectedPromptHistoryPromptRef,
      clearComposerDraftContent,
      setComposerCursor,
      selectedComposerSkillsRef,
      selectedComposerMentionsRef,
      selectedProvider,
      selectedModel,
      selectedPromptEffort,
      activeThreadIdRef,
      armTranscriptAutoFollow,
      tailAnchorScrollInFlightRef,
      providerStatuses,
      setOptimisticUserMessages,
      executePreparedTurn,
    ],
  );
  return { onSend };
}
