// Keep dirty editor drafts in place until the user explicitly saves.
import { useBlocker } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { toastManager } from "./ui/toast";

export function EditorDirtyRouteGuard() {
  const client = useQueryClient();
  useBlocker({
    shouldBlockFn: () => {
      if (!hasUnsavedWorkspaceEditors(client)) return false;
      toastManager.add({
        type: "warning",
        title: "Unsaved editor changes",
        description: "Press Cmd/Ctrl+S to save before leaving this chat.",
      });
      return true;
    },
    enableBeforeUnload: () => hasUnsavedWorkspaceEditors(client),
  });
  return null;
}
