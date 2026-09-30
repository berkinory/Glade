import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveWorktreeHandoffWorkspaceMetadata } from "@glade/shared/threads/worktreeHandoff";
import { useCallback } from "react";
import { gitHandoffThreadMutationOptions } from "~/lib/gitReactQuery";
import { toastManager } from "../components/ui/toast";
import { newCommandId } from "../lib/utils";
import { useStore } from "../store";
import type { Project, Thread } from "../types";

export function useThreadWorkspaceHandoff(input: {
  activeProject: Project | undefined;
  activeThread: Thread | undefined;
  activeRootBranch: string | null;
  activeThreadAssociatedWorktree: {
    associatedWorktreePath: string | null;
    associatedWorktreeBranch: string | null;
    associatedWorktreeRef: string | null;
  };
  isServerThread: boolean;
  stopActiveThreadSession: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const setThreadWorkspace = useStore((store) => store.setThreadWorkspace);
  const handoffThreadMutation = useMutation(
    gitHandoffThreadMutationOptions({ cwd: input.activeProject?.cwd ?? null, queryClient }),
  );

  const onHandoffToLocal = useCallback(async () => {
    if (
      !input.activeProject ||
      !input.activeThread ||
      !input.isServerThread ||
      handoffThreadMutation.isPending
    )
      return;
    try {
      await input.stopActiveThreadSession();
      const result = await handoffThreadMutation.mutateAsync({
        commandId: newCommandId(),
        threadId: input.activeThread.id,
        targetMode: "local",
        currentBranch: input.activeThread.branch ?? null,
        worktreePath: input.activeThread.worktreePath ?? null,
        associatedWorktreePath: input.activeThreadAssociatedWorktree.associatedWorktreePath,
        associatedWorktreeBranch: input.activeThreadAssociatedWorktree.associatedWorktreeBranch,
        associatedWorktreeRef: input.activeThreadAssociatedWorktree.associatedWorktreeRef,
        preferredLocalBranch: input.activeRootBranch ?? input.activeThread.branch ?? null,
        preferredWorktreeBaseBranch: null,
        preferredNewWorktreeName: null,
      });
      setThreadWorkspace(input.activeThread.id, resolveWorktreeHandoffWorkspaceMetadata(result));
      toastManager.add({
        type: result.conflictsDetected ? "warning" : "success",
        title: "Thread handed off to local",
        ...(result.message ? { description: result.message } : {}),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not hand off to local",
        description:
          error instanceof Error ? error.message : "An error occurred during the handoff.",
      });
    }
  }, [handoffThreadMutation, input, setThreadWorkspace]);

  return { handoffBusy: handoffThreadMutation.isPending, onHandoffToLocal };
}
