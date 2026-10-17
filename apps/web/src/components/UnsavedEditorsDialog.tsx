import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { create } from "zustand";

import { basenameOfPath } from "~/file-icons";
import {
  revertWorkspaceEditors,
  saveWorkspaceEditors,
  unsavedWorkspaceEditorPaths,
  type WorkspaceEditorScope,
} from "~/lib/workspaceEditorSession";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

interface UnsavedEditorsRequest {
  readonly client: QueryClient;
  readonly scope: WorkspaceEditorScope;
  readonly paths: readonly string[];
  readonly action: string;
  readonly resolve: (proceed: boolean) => void;
}

const useUnsavedEditorsRequest = create<{ request: UnsavedEditorsRequest | null }>(() => ({
  request: null,
}));

// Resolves true once no unsaved edits remain in scope: immediately when there are none, otherwise
// after the user saves or discards them. `action` completes "Save your changes before …".
export function resolveUnsavedWorkspaceEditors(
  client: QueryClient,
  scope: WorkspaceEditorScope,
  action: string,
): Promise<boolean> {
  const paths = unsavedWorkspaceEditorPaths(client, scope);
  if (paths.length === 0) return Promise.resolve(true);
  if (useUnsavedEditorsRequest.getState().request) return Promise.resolve(false);
  return new Promise((resolve) =>
    useUnsavedEditorsRequest.setState({ request: { client, scope, paths, action, resolve } }),
  );
}

export function UnsavedEditorsDialog() {
  const request = useUnsavedEditorsRequest((state) => state.request);
  const [saving, setSaving] = useState(false);
  const finish = (proceed: boolean) => {
    if (!request) return;
    useUnsavedEditorsRequest.setState({ request: null });
    request.resolve(proceed);
  };
  const save = async () => {
    if (!request || saving) return;
    setSaving(true);
    const saved = await saveWorkspaceEditors(request.client, request.scope);
    setSaving(false);
    if (!saved)
      toastManager.add({
        type: "error",
        title: "Could not save changes",
        description: "Check the open file for details and try again.",
      });
    finish(saved);
  };
  const single = request?.paths.length === 1 ? request.paths[0] : undefined;
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !saving) finish(false);
      }}
    >
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="truncate" title={single}>
            {single
              ? `Save changes to ${basenameOfPath(single)}?`
              : `Save changes to ${request?.paths.length ?? 0} files?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Save your changes before {request?.action}, or discard them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive-outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (!request) return;
              revertWorkspaceEditors(request.client, request.scope);
              finish(true);
            }}
          >
            Discard changes
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
