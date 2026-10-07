import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { summarizeToolRawOutput } from "~/features/chat/timeline/toolOutputSummary";
import {
  computerToolTarget,
  isGladeComputerToolName,
  type ComputerToolTarget,
} from "~/lib/computerToolPresentation";
import { deriveGladeMcpToolTitle } from "~/lib/toolCallLabel.descriptors";
import {
  extractGladeMcpToolName,
  normalizeGladeMcpIdentifier,
} from "~/lib/toolCallLabel.presentations";
import type { AppState } from "~/storeState";
import { extractToolCallId, extractToolName } from "~/workLog.extraction";

// Computer calls of a turn are recent; looking further back only costs time on long turns.
const SCAN_LIMIT = 120;

// One line for the running turn once it has used the computer, such as
// `Clicking · TextEdit · "Untitled"`, or null. Returns a string so store subscribers re-render
// only when the line changes.
export function selectComputerActivity(threadId: ThreadId) {
  return (state: AppState): string | null => {
    const turn = state.threadTurnStateById?.[threadId]?.latestTurn;
    const ids = state.activityIdsByThreadId?.[threadId];
    const byId = state.activityByThreadId?.[threadId];
    if (turn?.state !== "running" || !ids || !byId) return null;
    const settledCalls = new Set<string>();
    let usedComputer = false;
    let action: string | null = null;
    let target: string | null = null;
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
      const callId = extractToolCallId(payload) ?? activity.id;
      if (activity.kind === "tool.completed") {
        settledCalls.add(callId);
        const output = summarizeToolRawOutput(asObjectRecord(payload?.data)?.rawOutput);
        const named: ComputerToolTarget | null =
          target === null && output ? computerToolTarget(output) : null;
        if (named) {
          target = named.windowTitle ? `${named.app} · "${named.windowTitle}"` : named.app;
        }
      } else if (
        action === null &&
        (activity.kind === "tool.started" || activity.kind === "tool.updated") &&
        !settledCalls.has(callId)
      ) {
        action = deriveGladeMcpToolTitle({ toolName: gladeTool, status: "running" });
      }
      if (action !== null && target !== null) break;
    }
    if (!usedComputer) return null;
    return [action ?? "Using the computer", target].filter(Boolean).join(" · ");
  };
}
