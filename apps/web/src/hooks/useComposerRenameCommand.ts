import { useCallback } from "react";
import { toastManager } from "../components/ui/toast";
import { buildDraftThreadRenameCreateInput, dispatchThreadRename } from "../lib/threadRename";

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

      toastManager.add({
        type: "info",
        title: "Enter a title",
        description: "Use /rename followed by the new conversation title.",
      });
    },
    [activeThread, isLocalDraftThread, isServerThread],
  );

  return { runRenameSlashCommand };
}
