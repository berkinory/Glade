import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { gitRevertUnstagedFileMutationOptions } from "~/lib/gitReactQuery";
import { projectQueryKeys } from "~/lib/projectReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import type { SourceFile } from "./GitFileList";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export function GitRevertDialog(props: {
  cwd: string;
  files: readonly SourceFile[] | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const queryClient = useQueryClient();
  const { cwd, files } = props;
  const revertMutation = useMutation(gitRevertUnstagedFileMutationOptions({ cwd, queryClient }));
  const mutating =
    useIsMutating({
      predicate: (mutation) =>
        mutation.options.mutationKey?.[0] === "git" && mutation.options.mutationKey.includes(cwd),
    }) > 0;
  return (
    <AlertDialog
      open={files !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="truncate" title={files?.[0]?.path}>
            {files?.length === 1 ? "Revert changes?" : `Revert ${files?.length ?? 0} files?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {files?.length === 1
              ? files[0]?.status === "U"
                ? `Delete untracked file ${files[0].path}? This cannot be undone.`
                : `Discard unstaged changes in ${files?.[0]?.path}? Staged changes will remain.`
              : "Discard unstaged changes in the selected files? Untracked files will be deleted. Staged changes will remain."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={mutating}
            onClick={() => {
              void (async () => {
                if (!cwd || !files) return;
                if (hasUnsavedWorkspaceEditors(queryClient, cwd)) {
                  toastManager.add({
                    type: "warning",
                    title: "Save open files before reverting changes.",
                  });
                  return;
                }
                let completed = 0;
                try {
                  for (const file of files) {
                    await revertMutation.mutateAsync(file.path);
                    completed += 1;
                  }
                  if (files.some((file) => file.status === "U")) {
                    await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
                  }
                  props.onCompleted();
                  props.onClose();
                } catch (error) {
                  if (completed > 0) {
                    await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
                    props.onCompleted();
                    props.onClose();
                  }
                  toastManager.add({
                    type: "error",
                    title:
                      error &&
                      typeof error === "object" &&
                      "message" in error &&
                      typeof error.message === "string"
                        ? error.message
                        : "Could not revert file.",
                    ...(completed > 0
                      ? { description: `${completed} of ${files.length} files reverted.` }
                      : {}),
                  });
                }
              })();
            }}
          >
            Revert
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
