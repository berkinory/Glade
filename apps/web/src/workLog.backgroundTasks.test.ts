import { EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { describe, expect, it } from "vitest";

import { deriveBackgroundTasks } from "./workLog.backgroundTasks";

let sequence = 0;
function activity(
  kind: string,
  payload: Record<string, unknown> = {},
): OrchestrationThreadActivity {
  sequence += 1;
  return {
    id: EventId.makeUnsafe(`activity-${sequence}`),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.makeUnsafe("turn-1"),
    sequence,
    createdAt: `2026-10-14T00:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

const startBackgroundTask = () => [
  activity("task.started", { taskId: "build", detail: "Run the build" }),
  activity("task.updated", { taskId: "build", isBackgrounded: true }),
];

describe("deriveBackgroundTasks", () => {
  it.each([
    {
      name: "keeps a task running while its session lives",
      activities: startBackgroundTask(),
      expected: "running",
    },
    {
      name: "stops a task whose provider session ended without reporting it",
      activities: [...startBackgroundTask(), activity("background-work.reset")],
      expected: "stopped",
    },
    {
      name: "keeps the stop when a late end arrives from the old session",
      activities: [
        ...startBackgroundTask(),
        activity("background-work.reset"),
        activity("task.completed", { taskId: "build", status: "completed" }),
      ],
      expected: "stopped",
    },
  ])("$name", ({ activities, expected }) => {
    expect(deriveBackgroundTasks(activities).map((task) => task.status)).toEqual([expected]);
  });
});
