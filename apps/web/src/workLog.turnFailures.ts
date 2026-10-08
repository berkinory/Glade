import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";

import type { TimelineEntry, WorkLogEntry } from "./workLog.types";

const FALLBACK_TURN_FAILURE_MESSAGE = "The provider reported an error.";

// A provider error or failed completion bound to a turn. Unbound runtime errors stay ordinary rows.
export function isTurnFailureActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.turnId === null) return false;
  if (activity.kind === "runtime.error") return true;
  return (
    activity.kind === "turn.completed" &&
    (activity.tone === "error" || asObjectRecord(activity.payload)?.state === "failed")
  );
}

function payloadText(activity: OrchestrationThreadActivity, key: string): string | null {
  const value = asObjectRecord(activity.payload)?.[key];
  return nonEmptyTrimmed(value) ?? null;
}

// The last terminal state the provider reported for each turn. A turn that later completed or was
// cancelled is no longer failed, even though its earlier error activity remains stored.
function finalTurnStates(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Map<string, unknown> {
  const states = new Map<string, unknown>();
  for (const activity of activities) {
    if (activity.turnId && activity.kind === "turn.completed") {
      states.set(activity.turnId, asObjectRecord(activity.payload)?.state);
    }
  }
  return states;
}

interface TurnFailureEvidence {
  last: OrchestrationThreadActivity;
  runtimeMessage: string | null;
  completionMessage: string | null;
}

/** One durable failure entry per failed turn, placed at that turn's last failure activity. */
export function deriveTurnFailureEntries(
  orderedActivities: ReadonlyArray<OrchestrationThreadActivity>,
  isVisible: (activity: OrchestrationThreadActivity) => boolean,
): WorkLogEntry[] {
  const finalStates = finalTurnStates(orderedActivities);
  const evidenceByTurnId = new Map<string, TurnFailureEvidence>();
  for (const activity of orderedActivities) {
    if (!isTurnFailureActivity(activity) || !isVisible(activity)) continue;
    const turnId = activity.turnId!;
    const finalState = finalStates.get(turnId);
    if (finalState !== undefined && finalState !== "failed") continue;
    const previous = evidenceByTurnId.get(turnId);
    evidenceByTurnId.set(turnId, {
      last: activity,
      runtimeMessage:
        previous?.runtimeMessage ??
        (activity.kind === "runtime.error" ? payloadText(activity, "message") : null),
      completionMessage: previous?.completionMessage ?? payloadText(activity, "errorMessage"),
    });
  }
  return [...evidenceByTurnId].map(([turnId, evidence]) => ({
    id: `turn-failure:${turnId}`,
    createdAt: evidence.last.createdAt,
    ...(evidence.last.sequence !== undefined ? { sequence: evidence.last.sequence } : {}),
    turnId: evidence.last.turnId,
    tone: "error" as const,
    label: "Task failed",
    activityKind: evidence.last.kind,
    turnFailure: {
      // The runtime error carries the specific cause; a failed completion often only repeats it.
      message:
        evidence.runtimeMessage ?? evidence.completionMessage ?? FALLBACK_TURN_FAILURE_MESSAGE,
    },
  }));
}

/** Activities a client-side cap must keep so a failed turn's outcome survives trimming. */
export function turnFailureRetainedActivityIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<OrchestrationThreadActivity["id"]> {
  const failedTurnIds = new Set<string>();
  for (const activity of activities) {
    if (isTurnFailureActivity(activity)) failedTurnIds.add(activity.turnId!);
  }
  const retained = new Set<OrchestrationThreadActivity["id"]>();
  if (failedTurnIds.size === 0) return retained;
  for (const activity of activities) {
    if (
      activity.turnId !== null &&
      failedTurnIds.has(activity.turnId) &&
      (activity.kind === "runtime.error" || activity.kind === "turn.completed")
    ) {
      retained.add(activity.id);
    }
  }
  return retained;
}

export function findLatestTurnFailure(
  timelineEntries: ReadonlyArray<TimelineEntry>,
): WorkLogEntry | null {
  for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = timelineEntries[index]!;
    if (entry.kind === "work" && entry.entry.turnFailure) return entry.entry;
  }
  return null;
}

// The session error and the stored activity can differ only by the server's length cap.
export function isSameFailureMessage(threadError: string, failureMessage: string): boolean {
  const error = threadError.trim();
  const failure = failureMessage.trim();
  if (error === failure) return true;
  return failure.endsWith("...") && error.startsWith(failure.slice(0, -3));
}
