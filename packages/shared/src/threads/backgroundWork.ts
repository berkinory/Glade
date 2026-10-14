import { asRecord } from "../transport/payloadValues";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";

export interface BackgroundWork {
  taskIds: readonly string[];
  // Finished tasks that woke the agent, until the turn that reads their result starts. Absent from
  // servers that predate it.
  awaitingReplyTaskIds?: readonly string[] | undefined;
  failed: boolean;
  settledAt: string | null;
}

const ENDED_SESSION_STATUSES = new Set(["closed", "stopped", "error", "interrupted"]);

/** Whether a session in this status can still be running background work it started. */
export function sessionKeepsBackgroundWork(status: string | undefined): boolean {
  return !ENDED_SESSION_STATUSES.has(status ?? "");
}

/**
 * The turn and the earlier turns it continues: a turn that wakes the agent with a background task's
 * result names the turn that started the task.
 */
export function backgroundWorkTurnIds(
  activities: readonly Pick<OrchestrationThreadActivity, "kind" | "turnId" | "payload">[],
  turnId: TurnId | undefined,
): Set<string> {
  const turns = new Set<string>(turnId ? [turnId] : []);
  for (const activity of activities.toReversed()) {
    const payload = asRecord(activity.payload);
    if (
      activity.kind === "response.started" &&
      activity.turnId &&
      turns.has(activity.turnId) &&
      typeof payload?.backgroundParentTurnId === "string"
    )
      turns.add(payload.backgroundParentTurnId);
  }
  return turns;
}

export function deriveBackgroundWork(input: {
  activities: readonly Pick<
    OrchestrationThreadActivity,
    "id" | "kind" | "turnId" | "payload" | "createdAt" | "sequence"
  >[];
  turnId: TurnId | undefined;
  sessionStatus?: string | undefined;
}): BackgroundWork {
  const ownedTurns = backgroundWorkTurnIds(input.activities, input.turnId);
  const tasks = new Map<string, { background: boolean; terminal: boolean }>();
  const awaitingReply = new Set<string>();
  let failed = false;
  let settledAt: string | null = null;
  for (const activity of input.activities.toSorted(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      (a.sequence ?? 0) - (b.sequence ?? 0) ||
      a.id.localeCompare(b.id),
  )) {
    if (activity.kind === "background-work.reset") {
      failed ||= [...tasks.values()].some((task) => task.background && !task.terminal);
      tasks.clear();
      awaitingReply.clear();
      continue;
    }
    if (!activity.kind.startsWith("task.")) continue;
    const payload = asRecord(activity.payload);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.taskId !== "string"
    )
      continue;
    const previous = tasks.get(payload.taskId);
    if (activity.turnId && !ownedTurns.has(activity.turnId) && !previous) continue;
    if (!activity.turnId && !previous) continue;
    const terminal =
      activity.kind === "task.completed" ||
      ["completed", "failed", "killed", "stopped", "paused", "cancelled"].includes(
        String(payload.status),
      );
    if (previous?.terminal) continue;
    const background = payload.isBackgrounded === true || (previous?.background ?? false);
    if (payload.taskType === "plan") continue;
    tasks.set(payload.taskId, { background, terminal });
    // Only the latest turn waits: the wake turn that reads the result replaces it as the latest.
    if (terminal && payload.wakesAgent === true && activity.turnId === input.turnId) {
      awaitingReply.add(payload.taskId);
    }
    if (terminal && background) {
      // A task the agent or user killed or stopped ended on purpose; only a crash is a failure.
      failed ||= payload.status === "failed";
      settledAt = activity.createdAt;
    }
  }
  const active = sessionKeepsBackgroundWork(input.sessionStatus);
  return {
    taskIds: active
      ? [...tasks].filter(([, value]) => value.background && !value.terminal).map(([id]) => id)
      : [],
    awaitingReplyTaskIds: active ? [...awaitingReply] : [],
    failed:
      failed || (!active && [...tasks.values()].some((task) => task.background && !task.terminal)),
    settledAt,
  };
}
