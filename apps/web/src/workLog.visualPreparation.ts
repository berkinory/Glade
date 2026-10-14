import {
  VISUAL_REPLY_ACTIVITY_KIND,
  VISUAL_REPLY_STARTED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/visualReply";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import {
  extractGladeMcpToolName,
  normalizeGladeMcpIdentifier,
} from "./lib/toolCallLabel.presentations";
import type { WorkLogEntry } from "./workLog.types";

// Codex reports a tool start only after its arguments have been generated. The explicit begin
// activity covers that earlier interval and hands off to the real render call when it arrives.
export function reconcileVisualPreparation(
  entries: readonly WorkLogEntry[],
  activities: readonly OrchestrationThreadActivity[],
  activeTurnId: TurnId | null | undefined,
): WorkLogEntry[] {
  const settledTurns = new Set(
    activities
      .filter((activity) => activity.kind === "turn.completed" || activity.kind === "turn.aborted")
      .map((activity) => activity.turnId),
  );
  const pendingByTurn = new Map<string, WorkLogEntry>();
  const hidden = new Set<string>();
  const result: WorkLogEntry[] = [];
  for (const entry of entries) {
    const tool = extractGladeMcpToolName(normalizeGladeMcpIdentifier(entry.toolName ?? ""));
    if (tool === "glade_html_begin" && entry.toolStatus !== "failed") continue;
    const turnId = entry.turnId;
    if (!turnId) {
      result.push(entry);
      continue;
    }
    const starting = entry.activityKind === VISUAL_REPLY_STARTED_ACTIVITY_KIND;
    if (
      starting ||
      tool === "glade_html_render" ||
      entry.activityKind === VISUAL_REPLY_ACTIVITY_KIND
    ) {
      const previous = pendingByTurn.get(turnId);
      // Gateway activities and provider tool calls use separate sequence domains.
      if (previous && entry.createdAt >= previous.createdAt) {
        hidden.add(previous.id);
        pendingByTurn.delete(turnId);
      }
    }
    if (!starting) {
      result.push(entry);
      continue;
    }
    pendingByTurn.set(turnId, entry);
    const running =
      !settledTurns.has(turnId) && (activeTurnId === undefined || activeTurnId === turnId);
    result.push({
      ...entry,
      label: "Creating visual",
      preview: entry.label,
      toolName: "html_render",
      toolKind: "mcp",
      toolStatus: running ? "running" : "cancelled",
      liveActivity: {
        state: running ? "running_tool" : "cancelled",
        label: "Creating visual",
        startedAt: entry.createdAt,
        lastActivityAt: entry.createdAt,
      },
    });
  }
  return result.filter((entry) => !hidden.has(entry.id));
}
