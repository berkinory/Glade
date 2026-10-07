import { useThreadCompaction } from "./useThreadCompaction";
import { useCallback } from "react";
import { markDraftComputerUse, setComputerUseMode } from "../components/computer/computerUseState";
import { isElectron } from "../env";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import { toastManager } from "../components/ui/toast";
import {
  buildSlashReviewComposerPrompt,
  getAvailableComposerSlashCommands,
  hasProviderNativeSlashCommand,
  parseComposerSlashInvocationForCommands,
  parseFastSlashCommandAction,
  parseForkSlashCommandArgs,
} from "../composerSlashCommands";
import { extendReplacementRangeForTrailingSpace } from "../composerTriggerInsertion";
import { useFeedbackDialogStore } from "../feedbackDialogStore";
import { downloadUrlAsBlob } from "../lib/browserDownload";
import { resolveWsHttpUrl } from "../lib/wsHttpUrl";
import { readNativeApi } from "../nativeApi";
import { buildNextProviderOptions } from "../providerModelOptions";
import type { ComposerSlashCommandInput } from "./composerSlashCommandTypes";
import { useComposerForkCommands } from "./useComposerForkCommands";

import { useComposerRenameCommand } from "./useComposerRenameCommand";

type SlashCommandItem = Extract<ComposerCommandItem, { type: "slash-command" }>;

function wasPromptReplacementApplied(result: number | false): boolean {
  return result !== false;
}

export function useComposerSlashCommands(input: ComposerSlashCommandInput) {
  const openGlobalFeedbackDialog = useFeedbackDialogStore((state) => state.openDialog);
  const {
    activeProject,
    activeThread,
    environmentMode,
    runtimeMode,
    isServerThread,

    threadId,
    handleClearConversation,
  } = input.thread;
  const {
    supportsFastSlashCommand,
    canOfferCompactCommand,
    canOfferExportCommand,
    supportsTextNativeReviewCommand,
    fastModeEnabled,
    providerNativeCommands,
    providerCommandDiscoveryCwd,
    selectedProvider,
    currentProviderModelOptions,
    selectedModelSelection,
    setComposerDraftProviderModelOptions,
  } = input.provider;
  const { openForkTargetPicker, openReviewTargetPicker, editorActions } = input.editor;
  const providerNativeCommandNames = providerNativeCommands.map((command) => command.name);
  const availableBuiltInSlashCommands = getAvailableComposerSlashCommands({
    provider: selectedProvider,
    supportsFastSlashCommand,
    canOfferCompactCommand,
    canOfferReviewCommand: true,
    canOfferForkCommand: true,
    canOfferExportCommand,
    canOfferComputerUseCommand: isElectron,
    providerNativeCommandNames,
  });

  const { compact: compactProviderThread } = useThreadCompaction(activeThread?.id);

  // A draft has no server thread yet; its first send applies the mode.
  const turnOnComputerUseOnce = useCallback(async () => {
    if (isServerThread) await setComputerUseMode(threadId, "once");
    else markDraftComputerUse(threadId);
  }, [isServerThread, threadId]);

  const setFastModeFromSlashCommand = useCallback(
    (enabled: boolean) => {
      setComposerDraftProviderModelOptions(
        threadId,
        selectedProvider,
        buildNextProviderOptions(selectedProvider, currentProviderModelOptions, {
          fastMode: enabled,
        }),
        {
          persistSticky: true,
        },
      );
    },
    [currentProviderModelOptions, selectedProvider, setComposerDraftProviderModelOptions, threadId],
  );

  const runFastSlashCommand = useCallback(
    (text: string) => {
      const action = parseFastSlashCommandAction(text);
      if (action === null) {
        return false;
      }
      if (!supportsFastSlashCommand) {
        toastManager.add({
          type: "warning",
          title: "Fast mode is unavailable",
          description: "The selected model does not support Fast mode.",
        });
        return true;
      }
      if (action === "invalid") {
        toastManager.add({
          type: "warning",
          title: "Invalid /fast command",
          description: "Use /fast, /fast on, /fast off, or /fast status.",
        });
        return true;
      }
      if (action === "status") {
        toastManager.add({
          type: "info",
          title: `Fast mode is ${fastModeEnabled ? "on" : "off"}`,
        });
        return true;
      }
      const nextEnabled = action === "on" ? true : action === "off" ? false : !fastModeEnabled;
      setFastModeFromSlashCommand(nextEnabled);
      toastManager.add({
        type: "success",
        title: `Fast mode ${nextEnabled ? "enabled" : "disabled"}`,
      });
      return true;
    },
    [fastModeEnabled, supportsFastSlashCommand, setFastModeFromSlashCommand],
  );

  const { runRenameSlashCommand } = useComposerRenameCommand(input);

  const {
    createForkThreadFromSlashCommand,
    runCodexReviewStart,
    handleReviewTargetSelection,
    handleForkTargetSelection,
    handleForkFromMessage,
  } = useComposerForkCommands(input);

  const checkClaudeFastSlashCommandAvailability = useCallback(async (): Promise<boolean> => {
    const api = readNativeApi();
    if (!api || !providerCommandDiscoveryCwd) {
      editorActions.clearComposerSlashDraft();
      toastManager.add({
        type: "warning",
        title: "Fast mode could not be checked",
        description: "Claude command discovery is unavailable right now.",
      });
      return false;
    }

    try {
      const result = await api.provider.listCommands({
        provider: "claudeAgent",
        cwd: providerCommandDiscoveryCwd,
        threadId,
        forceReload: true,
      });
      if (
        hasProviderNativeSlashCommand(
          "claudeAgent",
          result.commands.map((command) => command.name),
          "fast",
        )
      ) {
        return true;
      }
    } catch {
      editorActions.clearComposerSlashDraft();
      toastManager.add({
        type: "warning",
        title: "Fast mode could not be checked",
        description: "Claude command discovery failed. Please try again.",
      });
      return false;
    }

    editorActions.clearComposerSlashDraft();
    toastManager.add({
      type: "info",
      title: "Fast mode is unavailable",
      description: "Claude did not expose /fast for this account or environment.",
    });
    return false;
  }, [editorActions, providerCommandDiscoveryCwd, threadId]);

  const runExportSlashCommand = useCallback(() => {
    if (!canOfferExportCommand) {
      toastManager.add({
        type: "warning",
        title: "Export is unavailable",
        description:
          "Open a server-backed thread and wait for the current turn to finish before exporting.",
      });
      return;
    }
    const params = new URLSearchParams({ threadId: threadId });
    void downloadUrlAsBlob({
      url: resolveWsHttpUrl(`/api/thread-export?${params.toString()}`),
      filename: `glade-thread-${threadId}.zip`,
    }).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not export thread",
        description:
          error instanceof Error ? error.message : "An error occurred while exporting the thread.",
      });
    });
  }, [canOfferExportCommand, threadId]);

  const openFeedbackDialog = useCallback(() => {
    openGlobalFeedbackDialog({
      provider: selectedProvider,
      model: selectedModelSelection.model,
      projectKind: activeProject?.kind ?? null,
      environmentMode,
      runtimeMode,

      sessionStatus: activeThread?.session?.status ?? null,
      latestTurnState: activeThread?.latestTurn?.state ?? null,
      messageCount: activeThread?.messages.length ?? 0,
      activityCount: activeThread?.activities.length ?? 0,
      hasPendingApproval: activeThread?.hasPendingApprovals === true,
      hasPendingUserInput: activeThread?.hasPendingUserInput === true,
      hasThreadError: Boolean(activeThread?.error),
    });
  }, [
    activeProject?.kind,
    activeThread,
    environmentMode,

    openGlobalFeedbackDialog,
    runtimeMode,
    selectedModelSelection.model,
    selectedProvider,
  ]);

  const handleStandaloneSlashCommand = useCallback(
    async (trimmed: string): Promise<boolean> => {
      const fastSlashAction = parseFastSlashCommandAction(trimmed);
      if (selectedProvider === "claudeAgent" && fastSlashAction !== null) {
        if (await checkClaudeFastSlashCommandAvailability()) {
          return false;
        }
        return true;
      }

      const slashInvocation = parseComposerSlashInvocationForCommands(
        trimmed,
        availableBuiltInSlashCommands,
      );
      if (!slashInvocation || slashInvocation.command === "model") {
        return false;
      }
      if (slashInvocation.command === "computer") {
        // Text after the command stays in the composer as the task to send next.
        if (slashInvocation.args) editorActions.setComposerPromptValue(slashInvocation.args);
        else editorActions.clearComposerSlashDraft();
        await turnOnComputerUseOnce();
        return true;
      }
      if (slashInvocation.command === "clear") {
        editorActions.clearComposerSlashDraft();
        await handleClearConversation();
        return true;
      }
      if (slashInvocation.command === "compact") {
        editorActions.clearComposerSlashDraft();
        await compactProviderThread(slashInvocation.args || undefined);
        return true;
      }
      if (slashInvocation.command === "rename") {
        editorActions.clearComposerSlashDraft();
        void runRenameSlashCommand(slashInvocation.args).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not rename thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while renaming the thread.",
          });
        });
        return true;
      }
      if (slashInvocation.command === "export") {
        editorActions.clearComposerSlashDraft();
        runExportSlashCommand();
        return true;
      }
      if (slashInvocation.command === "feedback") {
        editorActions.clearComposerSlashDraft();
        openFeedbackDialog();
        return true;
      }
      if (slashInvocation.command === "review") {
        if (selectedProvider === "codex") {
          const normalizedArgs = slashInvocation.args.trim().toLowerCase();
          if (normalizedArgs.length === 0) {
            editorActions.clearComposerSlashDraft();
            openReviewTargetPicker();
            return true;
          }
          const target =
            normalizedArgs === "base" || normalizedArgs.startsWith("base ") ? "base-branch" : null;
          if (!target) {
            toastManager.add({
              type: "warning",
              title: "Invalid /review command",
              description: "Use /review and then choose a review target.",
            });
            return true;
          }
          editorActions.clearComposerSlashDraft();
          await runCodexReviewStart(target);
          return true;
        }
        if (supportsTextNativeReviewCommand && slashInvocation.args.length === 0) {
          return false;
        }
        if (slashInvocation.args.length === 0) {
          editorActions.clearComposerSlashDraft();
          openReviewTargetPicker();
          return true;
        }
        editorActions.setComposerPromptValue(buildSlashReviewComposerPrompt(slashInvocation.args));
        return true;
      }
      if (slashInvocation.command === "fast") {
        editorActions.clearComposerSlashDraft();
        runFastSlashCommand(trimmed);
        return true;
      }
      if (slashInvocation.command === "fork") {
        const { target, invalid } = parseForkSlashCommandArgs(slashInvocation.args);
        if (invalid) {
          toastManager.add({
            type: "warning",
            title: "Invalid /fork command",
            description: "Use /fork and then choose Local or New Worktree.",
          });
          return true;
        }
        try {
          if (!target) {
            editorActions.clearComposerSlashDraft();
            openForkTargetPicker();
            return true;
          }
          await createForkThreadFromSlashCommand({
            target,
          });
          editorActions.clearComposerSlashDraft();
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
        return true;
      }
      return false;
    },
    [
      availableBuiltInSlashCommands,
      checkClaudeFastSlashCommandAvailability,
      compactProviderThread,
      createForkThreadFromSlashCommand,
      editorActions,
      handleClearConversation,

      openForkTargetPicker,
      openFeedbackDialog,
      openReviewTargetPicker,
      selectedProvider,
      supportsTextNativeReviewCommand,
      runCodexReviewStart,
      runExportSlashCommand,
      runFastSlashCommand,

      runRenameSlashCommand,
      turnOnComputerUseOnce,
    ],
  );

  const handleSlashCommandSelection = useCallback(
    (item: SlashCommandItem) => {
      const { snapshot, trigger } = editorActions.resolveActiveComposerTrigger();
      if (!trigger) {
        return;
      }

      if (item.command === "model" || item.command === "rename") {
        const replacement = `/${item.command} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = editorActions.applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (wasPromptReplacementApplied(applied)) {
          editorActions.setComposerHighlightedItemId(null);
          if (item.command !== "model") {
            editorActions.scheduleComposerFocus();
          }
        }
        return;
      }

      const clearSlashCommandFromComposer = () =>
        editorActions.applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });

      if (item.command === "clear") {
        const applied = clearSlashCommandFromComposer();
        if (wasPromptReplacementApplied(applied)) {
          editorActions.setComposerHighlightedItemId(null);
        }
        void handleClearConversation();
        return;
      }

      if (item.command === "compact") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        void compactProviderThread();
        editorActions.scheduleComposerFocus();
        return;
      }

      if (item.command === "computer") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        void turnOnComputerUseOnce();
        editorActions.scheduleComposerFocus();
        return;
      }

      if (item.command === "fast") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        void runFastSlashCommand("/fast");
        editorActions.scheduleComposerFocus();
        return;
      }

      if (item.command === "export") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        runExportSlashCommand();
        editorActions.scheduleComposerFocus();
        return;
      }

      if (item.command === "feedback") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        openFeedbackDialog();
        return;
      }

      if (item.command === "review") {
        if (selectedProvider === "codex") {
          const applied = clearSlashCommandFromComposer();
          if (!wasPromptReplacementApplied(applied)) {
            return;
          }
          editorActions.setComposerHighlightedItemId(null);
          openReviewTargetPicker();
          editorActions.scheduleComposerFocus();
          return;
        }
        if (supportsTextNativeReviewCommand) {
          const replacement = "/review";
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = editorActions.applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (wasPromptReplacementApplied(applied)) {
            editorActions.setComposerHighlightedItemId(null);
          }
          return;
        }
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        openReviewTargetPicker();
        editorActions.scheduleComposerFocus();
        return;
      }

      if (item.command === "fork") {
        const applied = clearSlashCommandFromComposer();
        if (!wasPromptReplacementApplied(applied)) {
          return;
        }
        editorActions.setComposerHighlightedItemId(null);
        openForkTargetPicker();
        editorActions.scheduleComposerFocus();
        return;
      }
    },
    [
      compactProviderThread,
      editorActions,
      handleClearConversation,

      openForkTargetPicker,
      openFeedbackDialog,
      openReviewTargetPicker,
      selectedProvider,
      supportsTextNativeReviewCommand,
      runExportSlashCommand,
      runFastSlashCommand,
      turnOnComputerUseOnce,
    ],
  );

  return {
    handleForkFromMessage,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    handleStandaloneSlashCommand,
    handleSlashCommandSelection,
  };
}
