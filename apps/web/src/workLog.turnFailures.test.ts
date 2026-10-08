import { EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { describe, expect, it } from "vitest";

import { deriveTurnFailureEntries } from "./workLog.turnFailures";

let sequence = 0;
function activity(
  kind: string,
  turnId: string | null,
  payload: { message?: string; errorMessage?: string; state?: string } = {},
): OrchestrationThreadActivity {
  sequence += 1;
  return {
    id: EventId.makeUnsafe(`activity-${sequence}`),
    tone: kind === "runtime.error" || payload.state === "failed" ? "error" : "info",
    kind,
    summary: kind,
    payload,
    turnId: turnId === null ? null : TurnId.makeUnsafe(turnId),
    sequence,
    createdAt: "2026-10-08T00:00:00.000Z",
  };
}

describe("deriveTurnFailureEntries", () => {
  it.each([
    {
      name: "keeps a provider failure with its specific cause",
      activities: [
        activity("runtime.error", "turn-1", { message: "Model at capacity" }),
        activity("turn.completed", "turn-1", { state: "failed", errorMessage: "failed" }),
      ],
      expected: [{ turnId: "turn-1", message: "Model at capacity" }],
    },
    {
      name: "keeps a failed completion without a runtime error",
      activities: [activity("turn.completed", "turn-1", { state: "failed", errorMessage: "Boom" })],
      expected: [{ turnId: "turn-1", message: "Boom" }],
    },
    {
      name: "drops a failure the same turn later recovered from",
      activities: [
        activity("runtime.error", "turn-1", { message: "Transient" }),
        activity("turn.completed", "turn-1", { state: "completed" }),
      ],
      expected: [],
    },
    {
      name: "treats a cancelled turn as cancelled, not failed",
      activities: [
        activity("runtime.error", "turn-1", { message: "Aborted" }),
        activity("turn.completed", "turn-1", { state: "cancelled" }),
      ],
      expected: [],
    },
    {
      name: "keeps an earlier failure after a later turn succeeds",
      activities: [
        activity("runtime.error", "turn-1", { message: "Lost connection" }),
        activity("turn.completed", "turn-2", { state: "completed" }),
      ],
      expected: [{ turnId: "turn-1", message: "Lost connection" }],
    },
    {
      name: "ignores runtime errors not bound to a turn",
      activities: [activity("runtime.error", null, { message: "Session noise" })],
      expected: [],
    },
  ])("$name", ({ activities, expected }) => {
    const entries = deriveTurnFailureEntries(activities, () => true);
    expect(
      entries.map((entry) => ({ turnId: entry.turnId, message: entry.turnFailure?.message })),
    ).toEqual(expected);
  });
});
