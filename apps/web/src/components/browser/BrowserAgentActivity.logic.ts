import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { deriveGladeMcpToolTitle } from "~/lib/toolCallLabel.descriptors";
import {
  extractGladeMcpToolName,
  normalizeGladeMcpIdentifier,
} from "~/lib/toolCallLabel.presentations";
import type { AppState } from "~/storeState";
import { extractToolCallId, extractToolName } from "~/workLog.extraction";

// A browser call is recent; looking further back only costs time on long turns.
const SCAN_LIMIT = 80;

// What the agent is doing in the browser right now, such as "Clicking", or null. Returns a string
// so store subscribers re-render only when the action changes.
export function selectBrowserAgentActivity(threadId: ThreadId) {
  return (state: AppState): string | null => {
    const turn = state.threadTurnStateById?.[threadId]?.latestTurn;
    const ids = state.activityIdsByThreadId?.[threadId];
    const byId = state.activityByThreadId?.[threadId];
    if (turn?.state !== "running" || !ids || !byId) return null;
    const settledCalls = new Set<string>();
    for (let index = ids.length - 1; index >= Math.max(0, ids.length - SCAN_LIMIT); index -= 1) {
      const activity = byId[ids[index]!];
      if (!activity || activity.turnId !== turn.turnId) continue;
      const payload = asObjectRecord(activity.payload);
      const toolName = extractToolName(payload);
      const gladeTool = toolName
        ? extractGladeMcpToolName(normalizeGladeMcpIdentifier(toolName))
        : null;
      if (!gladeTool?.startsWith("glade_browser_")) continue;
      const callId = extractToolCallId(payload) ?? activity.id;
      if (activity.kind === "tool.completed") settledCalls.add(callId);
      else if (
        (activity.kind === "tool.started" || activity.kind === "tool.updated") &&
        !settledCalls.has(callId)
      ) {
        return deriveGladeMcpToolTitle({ toolName: gladeTool, status: "running" });
      }
    }
    return null;
  };
}
