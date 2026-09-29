// FILE: fileReferenceContextMenu.ts
// Purpose: Right-click menu shared by file rows, file previews, and chat file
//          links (editor explorer, changed-file lists, dock file pane).
// Layer: Web UI helpers
// Exports: showFileReferenceContextMenu

import { formatSelectionLabel, type ChatFileReference } from "~/lib/chatReferences";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { getNavigatorPlatform, isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";
import { FILE_CONTEXT_MENU_ICONS } from "./contextMenuIcons";
import { showContextMenuFallback } from "~/contextMenuFallback";

function getRevealInFolderLabel(platform: string): string {
  if (isWindowsPlatform(platform)) {
    return "Open in Explorer";
  }
  if (isMacPlatform(platform)) {
    return "Reveal in Finder";
  }
  return "Show in folder";
}

function getOpenDirectoryLabel(platform: string): string {
  if (isWindowsPlatform(platform)) return "Open in Explorer";
  if (isMacPlatform(platform)) return "Open in Finder";
  return "Open in File Manager";
}

// Right-click menu shared by explorer rows, changed-file rows, and the file
// preview. Falls back to a DOM menu outside the desktop app.
export async function showFileReferenceContextMenu(input: {
  path: string;
  /** Absolute path to reveal in the platform file manager. Omit when the
   * surface only knows a repository-relative path. */
  revealPath?: string;
  revealKind?: "file" | "directory";
  position: { x: number; y: number };
  /** Line/column range from source views, or a quoted snippet from surfaces
   * without stable source lines (rendered markdown preview). */
  selection?: Omit<ChatFileReference, "path"> | null;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCreateFile?: (() => void) | undefined;
  onCreateFolder?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }
  const revealPath =
    input.revealPath && typeof window !== "undefined" && window.desktopBridge
      ? input.revealPath
      : undefined;
  const reference: ChatFileReference = {
    path: input.path,
    ...input.selection,
  };
  const rangeLabel = formatSelectionLabel(reference);
  const hasSnippet = typeof reference.snippet === "string" && reference.snippet.trim().length > 0;
  const items = [
    ...(input.onReferenceInChat
      ? [
          {
            id: "reference-in-chat" as const,
            icon: FILE_CONTEXT_MENU_ICONS.reference,
            label: rangeLabel
              ? `Reference ${rangeLabel} in chat`
              : hasSnippet
                ? "Reference selection in chat"
                : "Reference in chat",
          },
        ]
      : []),
    ...(input.onAskWhyInChat
      ? [
          {
            id: "ask-why-in-chat" as const,
            icon: FILE_CONTEXT_MENU_ICONS.reference,
            label: rangeLabel ? `Ask why ${rangeLabel} changed` : "Ask why this changed",
          },
        ]
      : []),
    ...(revealPath
      ? [
          {
            id: "reveal-in-folder" as const,
            icon: isMacPlatform(getNavigatorPlatform())
              ? FILE_CONTEXT_MENU_ICONS.finder
              : FILE_CONTEXT_MENU_ICONS.fileManager,
            label:
              input.revealKind === "directory"
                ? getOpenDirectoryLabel(getNavigatorPlatform())
                : getRevealInFolderLabel(getNavigatorPlatform()),
          },
        ]
      : []),
    { id: "copy-path" as const, label: "Copy path", icon: FILE_CONTEXT_MENU_ICONS.copy },
    ...(input.onCreateFile
      ? [
          {
            id: "create-file" as const,
            label: "New File",
            icon: FILE_CONTEXT_MENU_ICONS.createFile,
            separatorBefore: true,
          },
        ]
      : []),
    ...(input.onCreateFolder
      ? [
          {
            id: "create-folder" as const,
            label: "New Folder",
            icon: FILE_CONTEXT_MENU_ICONS.createFolder,
          },
        ]
      : []),
    ...(input.onRename
      ? [
          {
            id: "rename" as const,
            label: "Rename",
            icon: FILE_CONTEXT_MENU_ICONS.rename,
            separatorBefore: true,
          },
        ]
      : []),
    ...(input.onDelete
      ? [
          {
            id: "delete" as const,
            label: "Delete",
            icon: FILE_CONTEXT_MENU_ICONS.delete,
            destructive: true,
          },
        ]
      : []),
  ];
  // Explorer's destructive action needs the same red accent as the rest of the app.
  const clicked = input.onDelete
    ? await showContextMenuFallback(items, input.position)
    : await api.contextMenu.show(items, input.position);
  if (clicked === "reference-in-chat") {
    input.onReferenceInChat?.(reference);
    return;
  }
  if (clicked === "ask-why-in-chat") {
    input.onAskWhyInChat?.(reference);
    return;
  }
  if (clicked === "reveal-in-folder" && revealPath) {
    try {
      await api.shell.showInFolder(revealPath);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: input.revealKind === "directory" ? "Unable to open folder" : "Unable to reveal file",
        description:
          error instanceof Error ? error.message : "An unknown error occurred opening the file.",
      });
    }
    return;
  }
  if (clicked === "copy-path") {
    await copyTextToClipboard(input.path);
    return;
  }
  if (clicked === "create-file") input.onCreateFile?.();
  if (clicked === "create-folder") input.onCreateFolder?.();
  if (clicked === "rename") input.onRename?.();
  if (clicked === "delete") input.onDelete?.();
}
