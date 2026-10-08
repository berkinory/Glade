import {
  Copy01Icon,
  Delete02Icon,
  FilePlusIcon,
  Folder02Icon,
  FolderPlusIcon,
  MessageCircleIcon,
  PencilEdit02Icon,
} from "~/lib/icons";
import { FinderAppIcon } from "~/components/contextMenu/FinderAppIcon";
import { formatSelectionLabel, type ChatFileReference } from "~/lib/chatReferences";
import { copyTextToClipboard } from "./clipboard";
import { isLocalDesktopActive } from "~/environments/activeEnvironment";
import { getNavigatorPlatform, isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";
import { showContextMenu } from "~/components/contextMenu/contextMenuStore";

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

export async function showFileReferenceContextMenu(input: {
  path: string;

  revealPath?: string;
  revealKind?: "file" | "directory";
  position: { x: number; y: number };

  selection?: Omit<ChatFileReference, "path"> | null;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onCreateFile?: (() => void) | undefined;
  onCreateFolder?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }
  const revealPath = input.revealPath && isLocalDesktopActive() ? input.revealPath : undefined;
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
            icon: MessageCircleIcon,
            label: rangeLabel
              ? `Reference ${rangeLabel} in chat`
              : hasSnippet
                ? "Reference selection in chat"
                : "Reference in chat",
          },
        ]
      : []),
    ...(revealPath
      ? [
          {
            id: "reveal-in-folder" as const,
            icon: isMacPlatform(getNavigatorPlatform()) ? FinderAppIcon : Folder02Icon,
            label:
              input.revealKind === "directory"
                ? getOpenDirectoryLabel(getNavigatorPlatform())
                : getRevealInFolderLabel(getNavigatorPlatform()),
          },
        ]
      : []),
    { id: "copy-path" as const, label: "Copy path", icon: Copy01Icon },
    ...(input.onCreateFile
      ? [
          {
            id: "create-file" as const,
            label: "New File",
            icon: FilePlusIcon,
            separatorBefore: true,
          },
        ]
      : []),
    ...(input.onCreateFolder
      ? [
          {
            id: "create-folder" as const,
            label: "New Folder",
            icon: FolderPlusIcon,
          },
        ]
      : []),
    ...(input.onRename
      ? [
          {
            id: "rename" as const,
            label: "Rename",
            icon: PencilEdit02Icon,
            separatorBefore: true,
          },
        ]
      : []),
    ...(input.onDelete
      ? [
          {
            id: "delete" as const,
            label: "Delete",
            icon: Delete02Icon,
            destructive: true,
          },
        ]
      : []),
  ];

  const clicked = await showContextMenu(items, input.position);
  if (clicked === "reference-in-chat") {
    input.onReferenceInChat?.(reference);
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
