import { THREAD_GOAL_MAX_CHARS } from "@glade/contracts/orchestration/threadEntities";
import { useCallback } from "react";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { buildGoalSlashCommandPrompt, parseGoalSlashCommandArgs } from "../composerSlashCommands";
import {
  buildDraftThreadRenameCreateInput,
  dispatchThreadRename,
  dispatchThreadTitleRegeneration,
} from "../lib/threadRename";
import { dispatchThreadGoal, dispatchThreadGoalPaused } from "../threadGoal";
import type { ComposerSlashCommandInput } from "./composerSlashCommandTypes";
export function useComposerGoalCommands(input: {
  thread: Pick<
    ComposerSlashCommandInput["thread"],
    "activeThread" | "isServerThread" | "isLocalDraftThread"
  >;
  editor: Pick<ComposerSlashCommandInput["editor"], "editorActions">;
}) {
  const { activeThread, isServerThread, isLocalDraftThread } = input.thread;
  const { editorActions } = input.editor;
  const persistThreadGoal = useCallback(
    async (goal: string): Promise<boolean> => {
      if (!isServerThread && activeThread) {
        const draftStore = useComposerDraftStore.getState();
        if (draftStore.getDraftThread(activeThread.id)) {
          draftStore.setDraftThreadContext(activeThread.id, { goal });
          return true;
        }
      }
      if (!isServerThread || !activeThread) {
        toastManager.add({
          type: "warning",
          title: "Thread goal is unavailable",
          description: "Open a thread before setting a goal.",
        });
        return false;
      }

      try {
        await dispatchThreadGoal(activeThread.id, goal);
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not update thread goal",
          description:
            error instanceof Error ? error.message : "An error occurred while updating the goal.",
        });
        return false;
      }
    },
    [activeThread, isServerThread],
  );

  const clearThreadGoal = useCallback(async () => {
    if (await persistThreadGoal("")) {
      toastManager.add({ type: "success", title: "Thread goal cleared" });
    }
  }, [persistThreadGoal]);

  const setThreadGoalPaused = useCallback(
    async (paused: boolean): Promise<boolean> => {
      if (!isServerThread || !activeThread) {
        return false;
      }
      try {
        await dispatchThreadGoalPaused(activeThread.id, paused);
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: paused ? "Could not pause the thread goal" : "Could not resume the thread goal",
          description:
            error instanceof Error ? error.message : "An error occurred while updating the goal.",
        });
        return false;
      }
    },
    [activeThread, isServerThread],
  );

  const runGoalSlashCommand = useCallback(
    async (args: string) => {
      const action = parseGoalSlashCommandArgs(args);
      if (action.action === "show") {
        const currentGoal = activeThread?.goal?.trim();
        toastManager.add(
          currentGoal
            ? { type: "info", title: "Thread goal", description: currentGoal }
            : { type: "info", title: "No thread goal is set" },
        );
        return;
      }
      if (action.action === "too-long") {
        toastManager.add({
          type: "warning",
          title: "Thread goal is too long",
          description: `Keep the goal within ${THREAD_GOAL_MAX_CHARS.toLocaleString()} characters.`,
        });
        return;
      }
      if (action.action === "clear") {
        await clearThreadGoal();
        return;
      }
      if (action.action === "pause" || action.action === "resume") {
        const paused = action.action === "pause";
        if (await setThreadGoalPaused(paused)) {
          toastManager.add({
            type: "success",
            title: `Thread goal ${paused ? "paused" : "resumed"}`,
          });
        }
        return;
      }
      if (action.action === "edit") {
        const currentGoal = activeThread?.goal?.trim() ?? "";
        editorActions.setComposerPromptValue(buildGoalSlashCommandPrompt(currentGoal));
        editorActions.scheduleComposerFocus();
        return;
      }
      if (await persistThreadGoal(action.goal)) {
        toastManager.add({ type: "success", title: "Thread goal updated" });
      }
    },
    [activeThread?.goal, clearThreadGoal, editorActions, persistThreadGoal, setThreadGoalPaused],
  );

  const runRenameSlashCommand = useCallback(
    async (args: string) => {
      if (!activeThread) {
        toastManager.add({
          type: "warning",
          title: "Rename is unavailable",
          description: "Open a thread before renaming it.",
        });
        return;
      }
      if (args.length > 0) {
        if (!isServerThread && !isLocalDraftThread) {
          toastManager.add({ type: "warning", title: "Rename is unavailable" });
          return;
        }
        const outcome = await dispatchThreadRename({
          threadId: activeThread.id,
          newTitle: args,
          unchangedTitles: [],
          createIfMissing: isLocalDraftThread
            ? buildDraftThreadRenameCreateInput(activeThread)
            : undefined,
        });
        if (outcome === "renamed") {
          toastManager.add({ type: "success", title: "Thread renamed" });
        } else if (outcome === "unavailable") {
          toastManager.add({ type: "warning", title: "Rename is unavailable" });
        } else {
          toastManager.add({ type: "info", title: "Thread title is unchanged" });
        }
        return;
      }

      if (!isServerThread) {
        toastManager.add({
          type: "warning",
          title: "Nothing to rename yet",
          description: "Send a message before generating a thread title.",
        });
        return;
      }

      const outcome = await dispatchThreadTitleRegeneration(activeThread.id);
      if (outcome.status === "renamed") {
        toastManager.add({
          type: "success",
          title: "Thread renamed",
          description: outcome.title,
        });
      } else if (outcome.status === "no-context") {
        toastManager.add({
          type: "warning",
          title: "Nothing to rename yet",
          description: "Send a message before generating a thread title.",
        });
      } else if (outcome.status === "stale") {
        toastManager.add({
          type: "info",
          title: "Newer thread title kept",
          description: "The generated title was discarded because the title changed.",
        });
      } else if (outcome.status === "unavailable") {
        toastManager.add({ type: "warning", title: "Rename is unavailable" });
      } else {
        toastManager.add({ type: "info", title: "Thread title is unchanged" });
      }
    },
    [activeThread, isLocalDraftThread, isServerThread],
  );

  return { runGoalSlashCommand, runRenameSlashCommand, clearThreadGoal, setThreadGoalPaused };
}
