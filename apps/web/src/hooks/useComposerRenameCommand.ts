import { useCallback } from "react";
import { toastManager } from "../components/ui/toast";
import {
  buildDraftThreadRenameCreateInput,
  dispatchThreadRename,
  dispatchThreadTitleRegeneration,
} from "../lib/threadRename";

import type { ComposerSlashCommandInput } from "./composerSlashCommandTypes";
export function useComposerRenameCommand(input: {
  thread: Pick<
    ComposerSlashCommandInput["thread"],
    "activeThread" | "isServerThread" | "isLocalDraftThread"
  >;
  editor: Pick<ComposerSlashCommandInput["editor"], "editorActions">;
}) {
  const { activeThread, isServerThread, isLocalDraftThread } = input.thread;

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

  return { runRenameSlashCommand };
}
