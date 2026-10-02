import type { ProjectFileSystemEntry } from "@glade/contracts/workspace/project";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { toastManager } from "~/components/ui/toast";
import { refreshProjectDirectories } from "~/lib/projectDirectoryRefresh";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { ensureNativeApi } from "~/nativeApi";

type EntryKind = ProjectFileSystemEntry["kind"];
type ExplorerEdit = {
  action: "create" | "rename";
  kind: EntryKind;
  parent: string;
  entry?: ProjectFileSystemEntry;
};

export interface WorkspaceExplorerActions {
  readonly edit: ExplorerEdit | null;
  readonly busy: boolean;
  readonly selectedDirectory: string;
  readonly setSelectedDirectory: (path: string) => void;
  readonly create: (parent: string, kind: EntryKind) => void;
  readonly rename: (entry: ProjectFileSystemEntry) => void;
  readonly submitEdit: (name: string) => Promise<void>;
  readonly cancelEdit: () => void;
  readonly deleteEntry: (entry: ProjectFileSystemEntry) => void;
  readonly dialogs: ReactNode;
}

function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function useWorkspaceExplorerActions(
  cwd: string | null,
  selectedFilePath: string | null,
  onSelectFile: (path: string) => void,
  expandedDirectories: ReadonlySet<string>,
  onToggleDirectory: (path: string) => void,
  onDeleted?: (path: string) => void,
): WorkspaceExplorerActions {
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<ExplorerEdit | null>(null);
  const [selection, setSelection] = useState({
    filePath: selectedFilePath,
    directory: selectedFilePath?.split("/").slice(0, -1).join("/") ?? "",
  });
  const selectedDirectory =
    selection.filePath === selectedFilePath
      ? selection.directory
      : (selectedFilePath?.split("/").slice(0, -1).join("/") ?? "");
  const setSelectedDirectory = (directory: string) =>
    setSelection({ filePath: selectedFilePath, directory });
  const [deleting, setDeleting] = useState<ProjectFileSystemEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const blockDirtyMutation = () => {
    if (!hasUnsavedWorkspaceEditors(queryClient, cwd)) return false;
    toastManager.add({
      type: "warning",
      title: "Unsaved editor changes",
      description: "Press Cmd/Ctrl+S before renaming or deleting files.",
    });
    return true;
  };
  const create = (parent: string, kind: EntryKind) => {
    if (parent && !expandedDirectories.has(parent)) onToggleDirectory(parent);
    setSelectedDirectory(parent);
    setEdit({ action: "create", kind, parent });
  };
  const rename = (entry: ProjectFileSystemEntry) => {
    setSelectedDirectory(entry.kind === "directory" ? entry.path : (entry.parentPath ?? ""));
    setEdit({ action: "rename", kind: entry.kind, parent: entry.parentPath ?? "", entry });
  };
  const submitEdit = async (name: string) => {
    if (!cwd || !edit || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setEdit(null);
      return;
    }
    if (edit.action === "rename" && trimmed === edit.entry?.name) {
      setEdit(null);
      return;
    }
    if (edit.action === "rename" && blockDirtyMutation()) return;
    setBusy(true);
    try {
      const result = await ensureNativeApi().projects.manageEntry({
        cwd,
        action: edit.action,
        kind: edit.kind,
        relativePath: edit.entry?.path ?? childPath(edit.parent, trimmed),
        ...(edit.action === "rename" ? { nextName: trimmed } : {}),
      });
      setEdit(null);
      await refreshProjectDirectories(queryClient, cwd, [edit.parent || "."]);
      if (edit.action === "create" && edit.kind === "file") {
        onSelectFile(result.relativePath);
      }
      if (edit.action === "rename" && edit.entry) {
        const oldPath = edit.entry.path;
        if (selectedDirectory === oldPath || selectedDirectory.startsWith(`${oldPath}/`)) {
          setSelectedDirectory(result.relativePath + selectedDirectory.slice(oldPath.length));
        }
      }
      if (edit.action === "rename" && edit.entry && selectedFilePath) {
        const oldPath = edit.entry.path;
        if (selectedFilePath === oldPath || selectedFilePath.startsWith(`${oldPath}/`)) {
          onSelectFile(result.relativePath + selectedFilePath.slice(oldPath.length));
        }
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not change entry",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const dialogs = (
    <AlertDialog
      open={deleting !== null}
      onOpenChange={(open) => {
        if (!open) setDeleting(null);
      }}
    >
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="truncate" title={deleting?.name}>
            Delete {deleting?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleting?.kind === "directory"
              ? "This folder and its contents will be deleted."
              : "This file will be deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              void (async () => {
                if (!cwd || !deleting || blockDirtyMutation()) return;
                try {
                  await ensureNativeApi().projects.manageEntry({
                    cwd,
                    action: "delete",
                    kind: deleting.kind,
                    relativePath: deleting.path,
                  });
                  onDeleted?.(deleting.path);
                  setDeleting(null);
                  await refreshProjectDirectories(queryClient, cwd, [deleting.parentPath || "."]);
                } catch (error) {
                  toastManager.add({
                    type: "error",
                    title: "Could not delete entry",
                    description: error instanceof Error ? error.message : "Try again.",
                  });
                }
              })();
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
  return {
    edit,
    busy,
    selectedDirectory,
    setSelectedDirectory,
    create,
    rename,
    submitEdit,
    cancelEdit: () => setEdit(null),
    deleteEntry: setDeleting,
    dialogs,
  };
}
