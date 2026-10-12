import type {
  WorkspaceRestoreConfirmation,
  WorkspaceRestoreReview,
} from "@glade/contracts/orchestration/workspaceRestore";
import { create } from "zustand";

export type WorkspaceRestoreMode = "rewind" | "edit" | "undoFiles";

export type WorkspaceRestoreDecision =
  | { readonly kind: "keep" }
  | { readonly kind: "restore"; readonly confirmation: WorkspaceRestoreConfirmation };

export interface WorkspaceRestoreRequest {
  readonly mode: WorkspaceRestoreMode;
  readonly review: WorkspaceRestoreReview;
}

interface WorkspaceRestoreDecisionStore {
  readonly request:
    | (WorkspaceRestoreRequest & {
        readonly resolve: (decision: WorkspaceRestoreDecision | null) => void;
      })
    | null;
  readonly settle: (decision: WorkspaceRestoreDecision | null) => void;
}

export const useWorkspaceRestoreDecisionStore = create<WorkspaceRestoreDecisionStore>(
  (set, get) => ({
    request: null,
    settle: (decision) => {
      const request = get().request;
      set({ request: null });
      request?.resolve(decision);
    },
  }),
);

export function restoreConfirmation(review: WorkspaceRestoreReview): WorkspaceRestoreConfirmation {
  return {
    fingerprint: review.fingerprint,
    overwritePaths: review.files.filter((file) => file.conflict).map((file) => file.path),
  };
}

// Resolves null when the user cancels. Only a rewind needs a dialog when no file would change.
export function requestWorkspaceRestoreDecision(
  request: WorkspaceRestoreRequest,
): Promise<WorkspaceRestoreDecision | null> {
  if (request.review.files.length === 0 && request.mode !== "rewind") {
    return Promise.resolve(
      request.mode === "edit"
        ? { kind: "keep" }
        : { kind: "restore", confirmation: restoreConfirmation(request.review) },
    );
  }
  useWorkspaceRestoreDecisionStore.getState().settle(null);
  return new Promise((resolve) => {
    useWorkspaceRestoreDecisionStore.setState({ request: { ...request, resolve } });
  });
}
