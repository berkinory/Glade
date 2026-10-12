import { useState } from "react";
import { TriangleAlertIcon } from "~/lib/icons";
import { splitRepoRelativePath } from "~/lib/diffRendering";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { FileEntryIcon } from "./FileEntryIcon";
import {
  restoreConfirmation,
  useWorkspaceRestoreDecisionStore,
  type WorkspaceRestoreMode,
} from "./workspaceRestoreDecision";

const TITLES: Record<WorkspaceRestoreMode, string> = {
  rewind: "Rewind to this message?",
  edit: "Restore files too?",
  undoFiles: "Undo file changes?",
};

function describe(mode: WorkspaceRestoreMode, hasFiles: boolean): string {
  switch (mode) {
    case "rewind":
      return hasFiles
        ? "Later messages are removed and this message returns to the composer. These files changed since then: keep them as they are, or restore them."
        : "Later messages are removed and this message returns to the composer.";
    case "edit":
      return "These files changed after this message. Keep them as they are, or restore them to how they were before it.";
    case "undoFiles":
      return "These files go back to how they were before this turn.";
  }
}

function concurrentThreadsLabel(titles: ReadonlyArray<string>): string {
  const shown = titles.slice(0, 3).map((title) => `“${title}”`);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

export function WorkspaceRestoreDialog() {
  const request = useWorkspaceRestoreDecisionStore((state) => state.request);
  const settle = useWorkspaceRestoreDecisionStore((state) => state.settle);
  // Keeps the content in place while the popup animates out after settling.
  const [lastRequest, setLastRequest] = useState(request);
  if (request && request !== lastRequest) setLastRequest(request);
  const shown = request ?? lastRequest;
  if (!shown) return null;
  const { mode, review } = shown;
  const hasFiles = review.files.length > 0;
  const hasConflicts = review.files.some((file) => file.conflict);
  const restore = () => settle({ kind: "restore", confirmation: restoreConfirmation(review) });
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(null);
      }}
    >
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{TITLES[mode]}</AlertDialogTitle>
          <AlertDialogDescription>{describe(mode, hasFiles)}</AlertDialogDescription>
        </AlertDialogHeader>
        {hasFiles ? (
          <div className="flex min-h-0 flex-col gap-2 px-4 pb-2">
            {review.concurrentThreads.length > 0 ? (
              <Alert variant="warning" size="sm">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>
                  {review.concurrentThreads.length === 1
                    ? "Another chat worked in this folder"
                    : "Other chats worked in this folder"}
                </AlertTitle>
                <AlertDescription>
                  {`${concurrentThreadsLabel(review.concurrentThreads.map((thread) => thread.title))} also ran since then. Some of these changes may be theirs, and restoring would undo them.`}
                </AlertDescription>
              </Alert>
            ) : null}
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-[color:var(--color-border-light)] py-1">
              {review.files.map((file) => {
                const { dir, name } = splitRepoRelativePath(file.path);
                return (
                  <li
                    key={file.path}
                    title={file.path}
                    className="flex min-w-0 items-center gap-2 px-2.5 py-1 text-ui"
                  >
                    <FileEntryIcon
                      pathValue={file.path}
                      kind="file"
                      className="opacity-70 dark:opacity-80"
                    />
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="min-w-0 truncate text-foreground">{name}</span>
                      {dir ? (
                        <span className="min-w-0 shrink-[100] truncate text-ui-sm text-muted-foreground/60">
                          {dir.replace(/\/$/, "")}
                        </span>
                      ) : null}
                    </span>
                    {file.conflict ? (
                      <span className="ml-auto shrink-0 text-ui-xs text-warning">Edited later</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {hasConflicts ? (
              <p className="text-ui-sm text-muted-foreground">
                Files marked edited later changed after the agent's turn. Restoring overwrites those
                edits.
              </p>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </AlertDialogClose>
          {mode === "undoFiles" ? (
            <Button variant="destructive" size="sm" onClick={restore}>
              Restore files
            </Button>
          ) : hasFiles ? (
            <>
              <Button variant="destructive-outline" size="sm" onClick={restore}>
                Restore files
              </Button>
              <Button size="sm" onClick={() => settle({ kind: "keep" })}>
                Keep files
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => settle({ kind: "keep" })}>
              Rewind
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
