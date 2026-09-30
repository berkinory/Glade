import { type MessageId } from "@glade/contracts/core/baseSchemas";
import { deriveAssociatedWorktreeMetadata } from "@glade/shared/threads/threadWorkspace";
import { useCallback } from "react";
import { toastManager } from "../components/ui/toast";
import {
  buildSlashReviewComposerPrompt,
  type ForkSlashCommandTarget,
} from "../composerSlashCommands";
import { resolveForkThreadEnvironment } from "../lib/threadEnvironment";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { ComposerSlashCommandInput } from "./composerSlashCommandTypes";
export function useComposerForkCommands(input: {
  thread: Pick<
    ComposerSlashCommandInput["thread"],
    | "activeProject"
    | "activeThread"
    | "activeRootBranch"
    | "isServerThread"
    | "runtimeMode"
    | "syncServerShellSnapshot"
    | "navigateToThread"
  >;
  provider: Pick<
    ComposerSlashCommandInput["provider"],
    "selectedProvider" | "selectedModelSelection"
  >;
  editor: Pick<ComposerSlashCommandInput["editor"], "editorActions">;
}) {
  const {
    activeProject,
    activeThread,
    activeRootBranch,
    isServerThread,
    runtimeMode,

    syncServerShellSnapshot,
    navigateToThread,
  } = input.thread;
  const { selectedProvider, selectedModelSelection } = input.provider;
  const { editorActions } = input.editor;
  const createForkThreadFromSlashCommand = useCallback(
    async (inputOptions?: {
      target?: ForkSlashCommandTarget;

      throughMessageId?: MessageId | null;
    }) => {
      const api = readNativeApi();
      if (!api || !activeProject || !activeThread || !isServerThread) {
        toastManager.add({
          type: "warning",
          title: "Fork is unavailable",
          description: "Only existing server-backed threads can be forked right now.",
        });
        return true;
      }

      const forkMessage = inputOptions?.throughMessageId
        ? activeThread.messages.find((message) => message.id === inputOptions.throughMessageId)
        : activeThread.messages.findLast(
            (message) =>
              message.role === "assistant" &&
              !message.streaming &&
              (selectedProvider === "codex" ? message.turnId : message.providerMessageId),
          );
      if (
        !forkMessage ||
        selectedProvider !== activeThread.modelSelection.provider ||
        (selectedProvider === "codex" ? !forkMessage.turnId : !forkMessage.providerMessageId)
      ) {
        toastManager.add({ type: "warning", title: "This message has no native fork point" });
        return false;
      }
      const nextThreadId = newThreadId();
      const createdAt = new Date().toISOString();

      const resolvedTarget = resolveForkThreadEnvironment({
        target: inputOptions?.target ?? "local",
        activeRootBranch,
        sourceThread: activeThread,
      });

      await api.orchestration.dispatchCommand({
        type: "thread.fork.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        sourceThreadId: activeThread.id,
        projectId: activeProject.id,
        title: activeThread.title,
        modelSelection: selectedModelSelection,
        runtimeMode,

        envMode: resolvedTarget.envMode,
        branch: resolvedTarget.branch,
        worktreePath: resolvedTarget.worktreePath,
        workingDirectory: activeThread.workingDirectory ?? null,
        associatedWorktreePath: resolvedTarget.associatedWorktreePath,
        associatedWorktreeBranch: resolvedTarget.associatedWorktreeBranch,
        associatedWorktreeRef: resolvedTarget.associatedWorktreeRef,
        forkMessageId: forkMessage.id,
        createdAt,
      });
      const snapshot = await api.orchestration.getShellSnapshot();
      syncServerShellSnapshot(snapshot);
      await navigateToThread(nextThreadId);
      return true;
    },
    [
      activeProject,
      activeRootBranch,
      activeThread,

      isServerThread,
      navigateToThread,
      runtimeMode,
      selectedModelSelection,
      selectedProvider,
      syncServerShellSnapshot,
    ],
  );

  const runCodexReviewStart = useCallback(
    async (target: "changes" | "base-branch") => {
      const api = readNativeApi();
      if (!api || !activeThread || !activeProject) {
        toastManager.add({
          type: "warning",
          title: "Review is unavailable",
          description: "Open a project thread before starting a native review.",
        });
        return false;
      }

      if (target === "base-branch" && !activeRootBranch) {
        toastManager.add({
          type: "warning",
          title: "Base branch unavailable",
          description: "Select or detect a base branch before starting this review.",
        });
        return false;
      }

      const messageText =
        target === "base-branch" && activeRootBranch
          ? `Review against base branch ${activeRootBranch}`
          : "Review current changes";

      const nextThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      const nextThreadTitle =
        target === "base-branch" ? `${activeThread.title} Review` : `${activeThread.title} Review`;
      const associatedWorktree = deriveAssociatedWorktreeMetadata({
        branch: activeThread.branch,
        worktreePath: activeThread.worktreePath,
        associatedWorktreePath: activeThread.associatedWorktreePath ?? null,
        associatedWorktreeBranch: activeThread.associatedWorktreeBranch ?? null,
        associatedWorktreeRef: activeThread.associatedWorktreeRef ?? null,
      });

      const nextEnvMode =
        activeThread.envMode ?? (activeThread.worktreePath ? "worktree" : "local");
      const nextWorkingDirectory = activeThread.workingDirectory ?? null;
      const nextLastKnownPr = activeThread.lastKnownPr ?? null;
      const reviewTarget =
        target === "base-branch"
          ? ({ type: "baseBranch", branch: activeRootBranch! } as const)
          : ({ type: "uncommittedChanges" } as const);

      try {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: nextThreadId,
          projectId: activeProject.id,
          title: nextThreadTitle,
          modelSelection: selectedModelSelection,
          runtimeMode,

          envMode: nextEnvMode,
          branch: activeThread.branch,
          worktreePath: activeThread.worktreePath,
          workingDirectory: nextWorkingDirectory,
          lastKnownPr: nextLastKnownPr,
          ...associatedWorktree,
          createdAt,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: messageText,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          reviewTarget,
          dispatchMode: "queue",
          runtimeMode,

          createdAt,
        });
        const snapshot = await api.orchestration.getShellSnapshot();
        syncServerShellSnapshot(snapshot);
        await navigateToThread(nextThreadId);
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not start review",
          description:
            error instanceof Error ? error.message : "An error occurred while starting review.",
        });
        return false;
      }
    },
    [
      activeProject,
      activeRootBranch,
      activeThread,
      navigateToThread,
      runtimeMode,
      selectedModelSelection,
      syncServerShellSnapshot,
    ],
  );

  const handleReviewTargetSelection = useCallback(
    async (target: "changes" | "base-branch") => {
      if (selectedProvider === "codex") {
        await runCodexReviewStart(target);
      } else {
        const replacement = buildSlashReviewComposerPrompt(target === "base-branch" ? "base" : "");
        editorActions.setComposerPromptValue(replacement);
      }
      editorActions.scheduleComposerFocus();
    },
    [editorActions, selectedProvider, runCodexReviewStart],
  );

  const runForkThread = useCallback(
    async (inputOptions: {
      target: ForkSlashCommandTarget;
      throughMessageId?: MessageId | null;
    }) => {
      try {
        await createForkThreadFromSlashCommand(inputOptions);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not fork thread",
          description:
            error instanceof Error
              ? error.message
              : "An error occurred while creating the forked thread.",
        });
      }
    },
    [createForkThreadFromSlashCommand],
  );

  const handleForkTargetSelection = useCallback(
    async (target: ForkSlashCommandTarget) => {
      await runForkThread({ target });
    },
    [runForkThread],
  );

  const handleForkFromMessage = useCallback(
    (messageId: MessageId) => {
      void runForkThread({ target: "local", throughMessageId: messageId });
    },
    [runForkThread],
  );

  return {
    createForkThreadFromSlashCommand,
    runCodexReviewStart,
    handleReviewTargetSelection,
    handleForkTargetSelection,
    handleForkFromMessage,
  };
}
