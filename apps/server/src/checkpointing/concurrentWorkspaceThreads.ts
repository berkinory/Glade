import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { isWorkspaceRootWithin } from "@glade/shared/threads/threadWorkspace";
import { resolveThreadWorkspaceCwd } from "./Utils.ts";

// Other chats whose folder overlaps `cwd` and whose latest turn was still running at or after `since`:
// their edits land in the same whole-folder checkpoints, so a restore can roll them back too.
export function findConcurrentWorkspaceThreads(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly since: string;
  readonly snapshot: Pick<OrchestrationShellSnapshot, "threads" | "projects">;
}): Array<{ readonly id: ThreadId; readonly title: string }> {
  return input.snapshot.threads
    .filter((thread) => {
      if (thread.id === input.threadId || thread.parentThreadId === input.threadId) return false;
      const latestTurn = thread.latestTurn;
      if (!latestTurn?.startedAt) return false;
      if (latestTurn.completedAt !== null && latestTurn.completedAt < input.since) return false;
      const cwd = resolveThreadWorkspaceCwd({ thread, projects: input.snapshot.projects });
      return (
        cwd !== undefined &&
        (isWorkspaceRootWithin(cwd, input.cwd) || isWorkspaceRootWithin(input.cwd, cwd))
      );
    })
    .map((thread) => ({ id: thread.id, title: thread.title }));
}
