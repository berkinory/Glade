import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type {
  OrchestrationLatestTurnState,
  OrchestrationThreadActivity,
} from "@glade/contracts/orchestration/threadEntities";

import { finalTurnStates } from "./workLog.turnFailures";
import type { WorkLogEntry } from "./workLog.types";

const STOPPED_STATES: ReadonlySet<unknown> = new Set(["interrupted", "cancelled"]);

/** One entry per stopped turn, placed where the provider reported the stop. */
export function deriveTurnStopEntries(
  orderedActivities: ReadonlyArray<OrchestrationThreadActivity>,
  isVisible: (activity: OrchestrationThreadActivity) => boolean,
  latestTurn: {
    turnId: TurnId | undefined;
    state: OrchestrationLatestTurnState | null | undefined;
    completedAt: string | null | undefined;
  },
): WorkLogEntry[] {
  const finalStates = finalTurnStates(orderedActivities);
  const stopByTurnId = new Map<string, WorkLogEntry>();
  for (const activity of orderedActivities) {
    if (activity.kind !== "turn.completed" || !activity.turnId || !isVisible(activity)) continue;
    if (!STOPPED_STATES.has(finalStates.get(activity.turnId))) continue;
    stopByTurnId.set(activity.turnId, {
      id: `turn-stop:${activity.turnId}`,
      createdAt: activity.createdAt,
      ...(activity.sequence !== undefined ? { sequence: activity.sequence } : {}),
      turnId: activity.turnId,
      tone: "info",
      label: "Stopped",
      activityKind: activity.kind,
      turnStopped: true,
    });
  }
  // The latest turn's projection settles before the provider's completion activity arrives, and
  // keeps the outcome after older activities are trimmed.
  const { turnId, state, completedAt } = latestTurn;
  if (
    turnId &&
    state === "interrupted" &&
    completedAt &&
    !stopByTurnId.has(turnId) &&
    !finalStates.has(turnId)
  ) {
    stopByTurnId.set(turnId, {
      id: `turn-stop:${turnId}`,
      createdAt: completedAt,
      turnId,
      tone: "info",
      label: "Stopped",
      turnStopped: true,
    });
  }
  return [...stopByTurnId.values()];
}
