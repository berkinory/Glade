import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { Schema, Option } from "effect";
import { threadHasInFlightTurn, threadHasCheckpointRevertInProgress } from "./commandInvariants.ts";

const Task = Schema.Struct({ taskId: Schema.String, status: Schema.optional(Schema.String) });
const decodeTask = Schema.decodeUnknownOption(Task);

export function compactionBlockedReason(thread: OrchestrationThread): string | undefined {
  if (thread.archivedAt !== null) return "Unarchive the conversation before compacting.";
  if (threadHasInFlightTurn(thread) || threadHasCheckpointRevertInProgress(thread)) {
    return "Wait for the current operation to finish before compacting.";
  }
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    (thread.pendingInteractions?.length ?? 0) > 0
  ) {
    return "Resolve pending approvals and input before compacting.";
  }
  const activeTasks = new Set<string>();
  for (const activity of thread.activities) {
    if (
      !["task.started", "task.progress", "task.updated", "task.completed"].includes(activity.kind)
    )
      continue;
    const task = decodeTask(activity.payload);
    if (Option.isNone(task)) continue;
    if (
      activity.kind === "task.completed" ||
      ["completed", "failed", "killed", "paused"].includes(task.value.status ?? "")
    ) {
      activeTasks.delete(task.value.taskId);
    } else {
      activeTasks.add(task.value.taskId);
    }
  }
  if (activeTasks.size) return "Wait for background tasks to finish before compacting.";
  return undefined;
}
