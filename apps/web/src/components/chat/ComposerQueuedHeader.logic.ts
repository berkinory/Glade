import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type { ComposerThreadDraftState } from "../../composerDraftDomain";
import type { Thread } from "../../types";

export type QueuedComposerPauseReason = "stopped" | "error" | "usage-limit";

export interface QueuedComposerPause {
  readonly reason: QueuedComposerPauseReason;
  // Resume acknowledges this turn's failure or usage limit.
  readonly turnId: string;
}

const USAGE_LIMIT_ERROR_PATTERN = /\b(?:usage|rate)[ _-]limit/i;

function latestTurnHitUsageLimit(
  thread: Pick<Thread, "activities" | "error">,
  latestTurn: NonNullable<Thread["latestTurn"]>,
): boolean {
  // The thread error can outlive its turn, so it only counts for a failed turn.
  if (
    latestTurn.state === "error" &&
    thread.error &&
    USAGE_LIMIT_ERROR_PATTERN.test(thread.error)
  ) {
    return true;
  }
  for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
    const activity = thread.activities[index];
    if (!activity) continue;
    // Activities are chronological; nothing older than the request belongs to this turn.
    if (activity.turnId !== latestTurn.turnId && activity.createdAt < latestTurn.requestedAt) break;
    // A late rejection from an older turn must not pause the queue behind a newer one.
    if (activity.turnId !== null && activity.turnId !== latestTurn.turnId) continue;
    if (
      activity.kind === "account.rate-limited" &&
      asObjectRecord(activity.payload)?.status === "rejected"
    ) {
      return true;
    }
  }
  return false;
}

// A stop is recorded explicitly because providers can settle a stopped turn as completed, and it
// holds until Resume, a hand-sent message or an empty queue clears it. Failures and usage limits
// are read from the latest turn, so a newer turn that ends normally supersedes them.
export function deriveQueuedComposerPause(
  thread: Pick<Thread, "latestTurn" | "activities" | "error"> | undefined,
  draft:
    | Pick<ComposerThreadDraftState, "queuedTurns" | "queueStoppedTurnId" | "queueResumedTurnId">
    | undefined,
): QueuedComposerPause | null {
  const latestTurn = thread?.latestTurn;
  // A live turn already holds the queue; the pause shows once it settles.
  if (!thread || !draft || draft.queuedTurns.length === 0 || !latestTurn) return null;
  if (latestTurn.state === "running") return null;
  const acknowledged = draft.queueResumedTurnId === latestTurn.turnId;
  if (!acknowledged && latestTurnHitUsageLimit(thread, latestTurn)) {
    return { reason: "usage-limit", turnId: latestTurn.turnId };
  }
  if (draft.queueStoppedTurnId) return { reason: "stopped", turnId: latestTurn.turnId };
  if (!acknowledged && latestTurn.state === "error") {
    return { reason: "error", turnId: latestTurn.turnId };
  }
  return null;
}
