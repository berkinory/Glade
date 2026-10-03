import { asRecord } from "../transport/payloadValues";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";

export interface BackgroundWork {
  taskIds: readonly string[];
  failed: boolean;
  settledAt: string | null;
}

export function deriveBackgroundWork(input: {
  activities: readonly Pick<
    OrchestrationThreadActivity,
    "id" | "kind" | "turnId" | "payload" | "createdAt" | "sequence"
  >[];
  turnId: TurnId | undefined;
  sessionStatus?: string | undefined;
}): BackgroundWork {
  const tasks = new Map<string, { background: boolean; terminal: boolean }>();
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
    if (activity.turnId && activity.turnId !== input.turnId) continue;
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
    if (terminal && background) {
      failed ||= payload.status !== "completed";
      settledAt = activity.createdAt;
    }
  }
  const active = !["closed", "stopped", "error", "interrupted"].includes(input.sessionStatus ?? "");
  return {
    taskIds: active
      ? [...tasks].filter(([, value]) => value.background && !value.terminal).map(([id]) => id)
      : [],
    failed:
      failed || (!active && [...tasks.values()].some((task) => task.background && !task.terminal)),
    settledAt,
  };
}
