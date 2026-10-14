import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";

import type { WorkLogBackgroundTask } from "./workLog.types";

const STOPPED_STATUSES = new Set(["killed", "stopped", "cancelled", "paused"]);

function settledStatus(status: unknown): WorkLogBackgroundTask["status"] {
  if (status === "failed") return "failed";
  return typeof status === "string" && STOPPED_STATUSES.has(status) ? "stopped" : "completed";
}

/**
 * Work an agent left running in the background, such as a test run or a dev server, read from the
 * task events every provider reports. Subagents are not listed: they have their own card and list.
 */
export function deriveBackgroundTasks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkLogBackgroundTask[] {
  const tasks = new Map<
    string,
    WorkLogBackgroundTask & { taskType: string | null; background: boolean }
  >();
  const ordered = activities.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0),
  );
  for (const activity of ordered) {
    // A new or ended provider session ends the work the old one left running, even when it never
    // reported the end.
    if (activity.kind === "background-work.reset") {
      for (const task of tasks.values()) {
        if (task.settledAt !== null) continue;
        task.status = "stopped";
        task.settledAt = activity.createdAt;
      }
      continue;
    }
    if (!activity.kind.startsWith("task.")) continue;
    const payload = asObjectRecord(activity.payload);
    const taskId = nonEmptyTrimmed(payload?.taskId);
    if (!payload || !taskId) continue;
    const task = tasks.get(taskId) ?? {
      taskId,
      toolUseId: null,
      description: "",
      status: "running",
      turnId: activity.turnId,
      startedAt: activity.createdAt,
      settledAt: null,
      taskType: null,
      background: false,
    };
    task.taskType ??= nonEmptyTrimmed(payload.taskType) ?? null;
    task.toolUseId ??= nonEmptyTrimmed(payload.toolUseId) ?? null;
    task.turnId ??= activity.turnId;
    task.description ||= nonEmptyTrimmed(payload.detail) ?? "";
    task.background ||= payload.isBackgrounded === true;
    const terminal =
      activity.kind === "task.completed" ||
      payload.status === "failed" ||
      (typeof payload.status === "string" &&
        (payload.status === "completed" || STOPPED_STATUSES.has(payload.status)));
    if (terminal && task.settledAt === null) {
      task.status = settledStatus(payload.status);
      task.settledAt = activity.createdAt;
    }
    tasks.set(taskId, task);
  }
  return [...tasks.values()]
    .filter(
      (task) => task.background && task.taskType !== "local_agent" && task.taskType !== "plan",
    )
    .map(({ taskType: _taskType, background: _background, ...task }) => task);
}
