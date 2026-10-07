import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { computerToolTarget, isGladeComputerToolName } from "~/lib/computerToolPresentation";
import { gatewayToolCall } from "~/lib/gatewayToolCall";
import {
  extractGladeMcpToolName,
  normalizeGladeMcpIdentifier,
} from "~/lib/toolCallLabel.presentations";
import type { AppState } from "~/storeState";
import { extractToolName } from "~/workLog.extraction";

// Computer calls of a turn are recent; looking further back only costs time on long turns.
const SCAN_LIMIT = 120;

// `Using the computer · TextEdit` for the running turn once it has used the computer, or null.
// Returns a string so store subscribers re-render only when the line changes.
export function selectComputerActivity(threadId: ThreadId) {
  return (state: AppState): string | null => {
    const turn = state.threadTurnStateById?.[threadId]?.latestTurn;
    const ids = state.activityIdsByThreadId?.[threadId];
    const byId = state.activityByThreadId?.[threadId];
    if (turn?.state !== "running" || !ids || !byId) return null;
    let usedComputer = false;
    for (let index = ids.length - 1; index >= Math.max(0, ids.length - SCAN_LIMIT); index -= 1) {
      const activity = byId[ids[index]!];
      if (!activity || activity.turnId !== turn.turnId) continue;
      const payload = asObjectRecord(activity.payload);
      const toolName = extractToolName(payload);
      const gladeTool = toolName
        ? extractGladeMcpToolName(normalizeGladeMcpIdentifier(toolName))
        : null;
      if (!gladeTool || !isGladeComputerToolName(gladeTool)) continue;
      usedComputer = true;
      if (activity.kind !== "tool.completed") continue;
      const output = gatewayToolCall(gladeTool, payload, "completed").output;
      const app = output ? computerToolTarget(output)?.app : null;
      if (app) return `Using the computer · ${app}`;
    }
    return usedComputer ? "Using the computer" : null;
  };
}
