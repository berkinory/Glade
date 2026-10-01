import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import {
  checkpointRefForThreadTurn,
  checkpointRefForThreadTurnInManagedFamily,
  checkpointRefForThreadTurnStart,
  checkpointRefForThreadTurnStartInManagedFamily,
} from "./Utils";

export function scopedTurnCheckpoints(
  thread: Pick<OrchestrationThread, "id" | "checkpoints">,
  checkpoints: OrchestrationThread["checkpoints"],
) {
  return checkpoints
    .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
    .map((checkpoint) => ({
      beforeCheckpointRef:
        checkpointRefForThreadTurnStartInManagedFamily(
          checkpoint.checkpointRef,
          thread.id,
          checkpoint.turnId,
        ) ?? checkpointRefForThreadTurnStart(thread.id, checkpoint.turnId),
      afterCheckpointRef: checkpoint.checkpointRef,
      fallbackBeforeCheckpointRef:
        thread.checkpoints.find(
          (entry) => entry.checkpointTurnCount === checkpoint.checkpointTurnCount - 1,
        )?.checkpointRef ??
        checkpointRefForThreadTurnInManagedFamily(checkpoint.checkpointRef, thread.id, 0) ??
        checkpointRefForThreadTurn(thread.id, 0),
    }));
}
