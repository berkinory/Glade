import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { nonEmptyTrimmed, stripTerminalControlSequences } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";

import type { WorkLogEntry, WorkLogMonitorNotification } from "./workLog.types";

const OUTCOME_LABELS: Record<WorkLogMonitorNotification["outcome"], string> = {
  updated: "updated",
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
};

function monitorOutcome(value: unknown): WorkLogMonitorNotification["outcome"] {
  return value === "completed" || value === "failed" || value === "stopped" ? value : "updated";
}

/** Claude reports Monitor events as runtime warnings with a `monitor_event` detail. */
export function monitorNotificationEntryFields(
  activity: OrchestrationThreadActivity,
): Pick<WorkLogEntry, "label" | "tone" | "monitorNotification"> | undefined {
  if (activity.kind !== "runtime.warning") return undefined;
  const payload = asObjectRecord(activity.payload);
  const data = asObjectRecord(payload?.data);
  if (data?.subtype !== "monitor_event") return undefined;
  const name = nonEmptyTrimmed(data.name) ?? "";
  const outcome = monitorOutcome(data.outcome);
  const output = nonEmptyTrimmed(data.output) ?? nonEmptyTrimmed(payload?.message) ?? "";
  return {
    label: `Monitor${name ? ` · ${name}` : ""} ${OUTCOME_LABELS[outcome]}`,
    tone: outcome === "failed" ? "error" : "info",
    monitorNotification: {
      name,
      output: stripTerminalControlSequences(output),
      outcome,
      ...(data.mid_turn === true ? { midTurn: true as const } : {}),
    },
  };
}
