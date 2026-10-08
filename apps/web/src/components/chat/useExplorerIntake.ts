import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isLocalDesktopActive } from "~/environments/activeEnvironment";
import { ensureNativeApi } from "~/nativeApi";
import { collectComposerClipboardFiles } from "~/hooks/useComposerDropzone";
import { CHAT_FILE_REFERENCE_DRAG_TYPE } from "~/lib/chatReferences";
import {
  collectExplorerDropFiles,
  explorerImportFromFile,
  type ExplorerImport,
} from "~/lib/explorerFileIntake";
import { refreshProjectDirectories } from "~/lib/projectDirectoryRefresh";
import { toastManager } from "../ui/toast";

function isTreeControl(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    !!target.closest("[data-explorer-tree]") &&
    !target.closest("input, textarea, [contenteditable=true]")
  );
}

function dropDirectory(target: EventTarget): string {
  return target instanceof Element
    ? (target.closest<HTMLElement>("[data-import-directory]")?.dataset.importDirectory ?? "")
    : "";
}

export function useExplorerIntake(cwd: string | null, selectedDirectory: string) {
  const queryClient = useQueryClient();
  const importing = useRef(false);
  const nativePaste = useRef<Promise<boolean> | null>(null);
  const [targetDirectory, setTargetDirectory] = useState<string | null>(null);
  const importEntries = async (loadEntries: () => Promise<ExplorerImport[]>, directory: string) => {
    if (!cwd) return;
    if (importing.current) {
      toastManager.add({ type: "warning", title: "Wait for the current import to finish" });
      return;
    }
    importing.current = true;
    let imported = 0;
    try {
      for (const entry of await loadEntries()) {
        await ensureNativeApi().projects.manageEntry({
          cwd,
          action: "import",
          kind: entry.kind,
          relativePath: directory ? `${directory}/${entry.name}` : entry.name,
          source: entry.source,
        });
        imported += 1;
      }
      if (imported)
        toastManager.add({
          type: "success",
          title: `Imported ${imported} ${imported === 1 ? "entry" : "entries"}`,
        });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not import files",
        description: `${imported ? `${imported} entries imported. ` : ""}${error instanceof Error ? error.message : "Try again."}`,
        data: { copyText: error instanceof Error ? error.message : "Import failed." },
      });
    } finally {
      importing.current = false;
      await refreshProjectDirectories(queryClient, cwd, [directory || "."]);
    }
  };
  const pasteNativeFiles = async (directory: string) => {
    try {
      if (!isLocalDesktopActive()) return false;
      const files = await window.desktopBridge?.clipboard?.readFiles?.();
      if (!files?.length) return false;
      await importEntries(
        () =>
          Promise.resolve(
            files.map((file) => ({
              name: file.name,
              kind: file.kind,
              source: { type: "path" as const, path: file.path },
            })),
          ),
        directory,
      );
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not read clipboard files",
        description: error instanceof Error ? error.message : "Try again.",
      });
      return true;
    }
  };
  const externalFiles = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.types.includes("Files") &&
    !event.dataTransfer.types.includes(CHAT_FILE_REFERENCE_DRAG_TYPE);
  return {
    targetDirectory,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!cwd || !externalFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setTargetDirectory(dropDirectory(event.target));
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        setTargetDirectory(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!cwd || !externalFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const directory = dropDirectory(event.target);
      setTargetDirectory(null);
      const files = collectExplorerDropFiles(event.dataTransfer);
      void importEntries(
        () =>
          Promise.all(files.map(({ file, directory }) => explorerImportFromFile(file, directory))),
        directory,
      );
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (
        !cwd ||
        !isTreeControl(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "v"
      )
        return;
      nativePaste.current = pasteNativeFiles(selectedDirectory);
    },
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      if (!cwd || !isTreeControl(event.target)) return;
      const files = collectComposerClipboardFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      const pending = nativePaste.current ?? pasteNativeFiles(selectedDirectory);
      nativePaste.current = null;
      void pending.then((handled) => {
        if (!handled)
          return importEntries(
            () => Promise.all(files.map((file) => explorerImportFromFile(file))),
            selectedDirectory,
          );
      });
    },
  };
}
