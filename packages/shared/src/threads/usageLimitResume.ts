import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationLatestTurn } from "@glade/contracts/orchestration/threadEntities";
import {
  USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/usageLimitResume";

import { asObjectRecord } from "../transport/payloadValues";

// A reset the host slept or was closed through by more than this waits for the user instead: they
// may be back at the machine, and a task resumed hours late may no longer be wanted.
export const USAGE_LIMIT_RESUME_GRACE_MS = 30 * 60_000;

export interface PendingUsageLimitResume {
  readonly turnId: TurnId;
  readonly resetsAt: string;
}

// Only the turn the limit stopped can resume; any newer turn, sent by hand or not, supersedes it.
export function pendingUsageLimitResume(input: {
  readonly latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "state"> | null;
  // Chronological.
  readonly activities: ReadonlyArray<{
    readonly kind: string;
    readonly turnId: TurnId | null;
    readonly payload: unknown;
  }>;
  readonly nowMs: number;
}): PendingUsageLimitResume | null {
  const latestTurn = input.latestTurn;
  if (latestTurn?.state !== "error") return null;
  for (let index = input.activities.length - 1; index >= 0; index -= 1) {
    const activity = input.activities[index];
    if (!activity || activity.turnId !== latestTurn.turnId) continue;
    if (activity.kind === USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND) return null;
    if (activity.kind !== USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND) continue;
    const resetsAt = asObjectRecord(activity.payload)?.resetsAt;
    if (typeof resetsAt !== "string") return null;
    const resetsAtMs = Date.parse(resetsAt);
    if (Number.isNaN(resetsAtMs) || resetsAtMs + USAGE_LIMIT_RESUME_GRACE_MS < input.nowMs) {
      return null;
    }
    return { turnId: latestTurn.turnId, resetsAt };
  }
  return null;
}
