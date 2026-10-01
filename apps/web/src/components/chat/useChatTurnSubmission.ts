import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { resolveComputerInvocationMode } from "@glade/shared/computer/computerInvocation";
import {
  prepareComputerPermissionGuide,
  readLocalComputerPermissionBridge,
} from "~/lib/computerProvisioning";
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
import { appendBrowserAnnotationsToPrompt } from "../../lib/browserAnnotations";
import { appendPastedTextsToPrompt } from "../../lib/composerPastedText";
import {
  findPendingBlobComposerAttachments,
  hydratePendingBlobComposerAttachments,
  readFileAsDataUrl,
  stageUploadComposerAttachments,
} from "../../lib/composerSend";
import { appendFileCommentsToPrompt } from "../../lib/fileComments";
import { appendPullRequestContextsToPrompt } from "../../lib/pullRequestContext";
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
import { resolveEnvironmentPanelPreferenceAfterFirstSend } from "../ChatView.logic.worktree";
import { toastManager } from "../ui/toast";
import type { ChatTurnSubmissionControllerInput } from "./chatSendTypes";
import { prepareChatSendWorkspace } from "./prepareChatSendWorkspace";
import { buildQueuedComposerPreviewText } from "./queuedComposerPreview";
import { resolveChatPromptCaptures } from "./resolveChatPromptCaptures";
import { useChatTurnExecution } from "./useChatTurnExecution";

export function useChatTurnSubmission({
  props,
  provider,
  turn,
  session,
  environment,
  composer,
  actions,
  workspace,
  transcript,
  discovery,
}: ChatTurnSubmissionControllerInput) {
  const { threadId } = props;
  const {
    hasLiveTurn,
    isConnecting,

    hasQueueableLiveTurn,
    isSendBusy,
    worktreeSetupResolutionRef,
    setWorktreeSetupPendingAction,
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
    syncServerShellSnapshot,
    setStoreThreadError,
    queryClient,
    setComposerHighlightedItemId,
    settings,
    composerEditorRef,
    promptRef,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerBrowserAnnotations,
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
  const {
    setEnvironmentPanelPreferenceOpen,
    environmentPanelPreferenceOpen,
    turnDispatchSettings,
    armTranscriptAutoFollow,
    tailAnchorScrollInFlightRef,
  } = environment;
  const {
    scheduleComposerFocus,
    setThreadError,
    isVoiceTranscribing,
    waitForPendingComposerImages,
    computerControlChangeSequence,
  } = composer;
  const { clearComposerInput } = actions;
  const {
    activeProject,
    isServerThread,
    chatWorkspaceRoot,
    isHomeChatContainer,
    resolvedThreadWorktreePath,
    isContainerLandingProject,
  } = workspace;
  const {
    threadWorkspaceCwd,
    activeRootBranch,
    gitBranchSourceCwd,
    isCenteredEmptyLanding,
    setTailAnchor,
    setOptimisticUserMessages,
  } = transcript;
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
      if (
        !api ||
        !lateSendHandlers ||
        !activeThread ||
        isSendBusy ||
        isConnecting ||
        isVoiceTranscribing ||
        sendPreflightInFlightRef.current ||
        sendInFlightRef.current
      ) {
        return false;
      }
      sendPreflightInFlightRef.current = true;
      const editorSaved = !hasUnsavedWorkspaceEditors(
        queryClient,
        threadWorkspaceCwd ?? chatWorkspaceRoot,
      );
      sendPreflightInFlightRef.current = false;
      if (!editorSaved) {
        setThreadError(
          threadId,
          "Save your editor changes with Cmd/Ctrl+S before sending. Your prompt and file draft are preserved.",
        );
        return false;
      }
      if (!queuedTurn) {
        sendPreflightInFlightRef.current = true;
        await waitForPendingComposerImages();
        sendPreflightInFlightRef.current = false;
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
      const computerControlSequenceForSend = computerControlChangeSequence.current;
      const liveComposerSnapshot =
        queuedChatTurn === null ? (composerEditorRef.current?.readSnapshot() ?? null) : null;
      let promptForSend =
        queuedChatTurn?.prompt ?? liveComposerSnapshot?.value ?? promptRef.current;
      if (queuedChatTurn === null) {
        // Read the live editor snapshot, not an earlier React render. A queued command already froze its
        // mode and generation and must not be inferred again.
        const mode = resolveComputerInvocationMode({
          messageText: promptForSend,
          enableComputerControl: settings.computerControlEnabled,
        });
        dispatchSettings = {
          ...dispatchSettings,
          computerControlMode: mode,
          enableComputerControl: mode !== "off",
        };
      }
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
      const composerAssistantSelectionsForSend =
        queuedChatTurn?.assistantSelections ?? composerAssistantSelections;
      const composerBrowserAnnotationsForSend =
        queuedChatTurn?.browserAnnotations ?? composerBrowserAnnotations;
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
        browserAnnotationCount: composerBrowserAnnotationsForSend.length,
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
        composerBrowserAnnotationsForSend.length === 0 &&
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
      if (!activeProject) return false;

      if (dispatchSettings.computerControlMode === "request") {
        const computerPermission = readLocalComputerPermissionBridge();
        const activeThreadBeforeCheck = activeThreadIdRef.current;
        const draftBeforeCheck = promptRef.current;
        sendPreflightInFlightRef.current = true;
        const ready = await prepareComputerPermissionGuide({
          ...(computerPermission
            ? {
                getPermissionState: computerPermission.getState,
                startPermissionSetup: computerPermission.startPermissionSetup,
              }
            : {}),
          isCurrent: () =>
            activeThreadIdRef.current === activeThreadBeforeCheck &&
            computerControlChangeSequence.current === computerControlSequenceForSend &&
            (queuedChatTurn !== null || promptRef.current === draftBeforeCheck),
        })
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: "Computer permission setup could not start",
              description: String(error),
            });
            return false;
          })
          .finally(() => {
            sendPreflightInFlightRef.current = false;
          });
        if (!ready) return false;
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
          title: sendProviderAvailability.unavailableReason,
        });
        return false;
      }

      const captures = await resolveChatPromptCaptures({
        api,
        activeThread,
        promptForSend,
        composerImagesForSend,
        composerFilesForSend,
        composerAssistantSelectionsForSend,
      });
      composerImagesForSend = captures.composerImagesForSend;

      if (hasQueueableLiveTurn && dispatchMode === "queue" && queuedChatTurn === null) {
        clearComposerInput(activeThread.id);
        scheduleComposerFocus();
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
            browserAnnotations: composerBrowserAnnotationsForSend,
            terminalContexts: sendableComposerTerminalContexts,
            fileComments: composerFileCommentsForSend,
            pastedTexts: sendableComposerPastedTexts,
            pullRequestContexts: sendableComposerPullRequestContexts,
          }),
          prompt: promptForSend,
          images: queuedImagesForPersistence,
          files: composerFilesForSend,
          assistantSelections: composerAssistantSelectionsForSend,
          browserAnnotations: composerBrowserAnnotationsForSend,
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
            title: "Could not resume thread",
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
        composerBrowserAnnotationsForSend,
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
        currentActiveGitBranch,
        isContainerLandingProject,
        api,
        syncServerShellSnapshot,
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
        setupScriptForWorktree,
        worktreeSetupScriptName,
        worktreeCopiesLocalChanges,
      } = workspace;
      const messageIdForSend = newMessageId();
      const worktreeSetupResolution = baseBranchForWorktree
        ? createWorktreeSetupResolution()
        : null;
      worktreeSetupResolutionRef.current = worktreeSetupResolution;
      if (worktreeSetupResolution) {
        setWorktreeSetupPendingAction(null);
      }

      sendInFlightRef.current = true;
      beginLocalDispatch({
        expectedUserMessageId: messageIdForSend,
        ...(baseBranchForWorktree
          ? {
              worktreeSetupStepId: "create-branch" as const,
              setupScriptName: worktreeSetupScriptName,
              copyLocalChanges: worktreeCopiesLocalChanges,
            }
          : {}),
      });

      const composerImagesSnapshot = [...composerImagesForSend];
      const composerFilesSnapshot = [...composerFilesForSend];
      const composerAssistantSelectionsSnapshot = [...composerAssistantSelectionsForSend];
      const composerBrowserAnnotationsSnapshot = composerBrowserAnnotationsForSend.map(
        (annotation) => ({ ...annotation, source: { ...annotation.source } }),
      );
      const composerFileCommentsSnapshot = [...composerFileCommentsForSend];
      const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
      const composerPastedTextsSnapshot = [...sendableComposerPastedTexts];
      const composerPullRequestContextsSnapshot = [...sendableComposerPullRequestContexts];
      const composerSkillsSnapshot = [...selectedComposerSkillsForSend];
      const composerMentionsSnapshot = [...selectedComposerMentionsForSend];

      const messageTextForSend = appendBrowserAnnotationsToPrompt(
        appendPullRequestContextsToPrompt(
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
        ),
        composerBrowserAnnotationsSnapshot,
        messageIdForSend,
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
      // Sending the first message flips the centered empty landing into a normal transcript. Clear
      // session-only landing overrides when default-open is enabled; otherwise keep the transition
      // closed.
      if (isCenteredEmptyLanding) {
        setEnvironmentPanelPreferenceOpen(
          resolveEnvironmentPanelPreferenceAfterFirstSend({
            isCenteredEmptyLanding,
            settingsDefaultOpen: settings.environmentPanelDefaultOpen,
            currentPreferenceOpen: environmentPanelPreferenceOpen,
          }),
        );
      }
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
      // Queued turns are dispatched from their captured snapshot, so this send path must not clear a
      // separate live draft the user may already be editing.
      if (queuedChatTurn === null) {
        promptHistoryNavigationRef.current = null;
        applyingPromptHistoryNavigationRef.current = false;
        expectedPromptHistoryPromptRef.current = null;
        promptRef.current = "";
        clearComposerDraftContent(threadIdForSend, { preservePreviewUrls: true });

        setComposerHighlightedItemId(null);
        setComposerCursor(0);
        setComposerTrigger(null);

        scheduleComposerFocus();
      }

      return executePreparedTurn({
        nextThreadEnvMode,
        nextThreadBranch,
        nextThreadWorktreePath,
        nextAssociatedWorktreePath,
        nextAssociatedWorktreeBranch,
        nextAssociatedWorktreeRef,
        turnDispatchSettings: dispatchSettings,
        computerControlSequenceForSend,
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

        nextThreadWorkingDirectory,
        activeThread,
        targetProjectKindForSend,
        setupScriptForWorktree,
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
        composerBrowserAnnotationsSnapshot,
        composerFileCommentsSnapshot,
        composerTerminalContextsSnapshot,
        composerPastedTextsSnapshot,
        composerPullRequestContextsSnapshot,
        composerSkillsSnapshot,
        composerMentionsSnapshot,
      });
    },
    [
      threadId,
      hasLiveTurn,
      lateComposerSendHandlersRef,
      activeThread,
      isConnecting,
      sendPreflightInFlightRef,
      sendInFlightRef,
      turnDispatchSettings,
      computerControlChangeSequence,

      hasQueueableLiveTurn,
      clearComposerInput,
      scheduleComposerFocus,
      activeProject,
      threadWorkspaceCwd,
      refreshProviderStatuses,
      isServerThread,
      hasNativeUserMessages,
      chatWorkspaceRoot,
      isHomeChatContainer,
      resolvedThreadWorktreePath,
      currentActiveGitBranch,
      isContainerLandingProject,
      syncServerShellSnapshot,
      activeRootBranch,
      gitBranchSourceCwd,
      setStoreThreadError,
      queryClient,
      isCenteredEmptyLanding,
      setEnvironmentPanelPreferenceOpen,
      environmentPanelPreferenceOpen,
      setTailAnchor,
      setThreadError,
      setComposerHighlightedItemId,
      settings,
      isSendBusy,
      worktreeSetupResolutionRef,
      setWorktreeSetupPendingAction,
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
      composerBrowserAnnotations,
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
