import type { GitRemoveWorktreeInput } from "@glade/contracts/git/git";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { toastManager } from "../components/ui/toast";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";

export type ArchiveWorktreeCleanupOutcome = "removed" | "kept" | "skipped";

// The removal is never forced, so a worktree with uncommitted changes survives, and nothing here
// throws: the archive already succeeded and must not be reported as failed.
export async function releaseOrphanedWorktreeAfterArchive(input: {
  readonly threadId: ThreadId;

  readonly archiveSequence: number;

  readonly enabled: boolean;
  readonly removeWorktree: (input: GitRemoveWorktreeInput) => Promise<unknown>;
}): Promise<ArchiveWorktreeCleanupOutcome> {
  if (!input.enabled) return "skipped";
  const state = useStore.getState();
  const thread = getThreadFromState(state, input.threadId);
  if (!thread || thread.archivedAt == null) return "skipped";
  const project = state.projects.find((candidate) => candidate.id === thread.projectId) ?? null;
  if (!project) return "skipped";
  const worktreePath = thread.worktreePath ?? thread.associatedWorktreePath;
  if (!worktreePath) return "skipped";
  const displayName = formatWorktreePathForDisplay(worktreePath);
  try {
    await input.removeWorktree({
      cwd: project.cwd,
      path: worktreePath,
      force: false,
      reclaimTemporaryBranch: false,
      archiveCleanup: { threadId: input.threadId, archiveSequence: input.archiveSequence },
    });
  } catch (error) {
    console.info("Kept worktree after archiving its thread", {
      threadId: input.threadId,
      worktreePath,
      error,
    });
    toastManager.add({
      type: "info",
      title: "Worktree kept",
      description: `${displayName} could not be removed safely. Check its task, Git status, or connection.`,
    });
    return "kept";
  }
  toastManager.add({
    type: "success",
    title: "Worktree removed",
    description: `${displayName} was deleted. Its branch remains available for recovery.`,
  });
  return "removed";
}
