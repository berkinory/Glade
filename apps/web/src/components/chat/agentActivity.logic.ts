import { deepEqualJson } from "../../storeNormalization.shared";
import { normalizeCompactToolLabel } from "../../lib/toolCallLabel.presentations";
import type { WorkLogEntry } from "../../workLog.types";

export interface AgentActivityDetail {
  id: string;
  entry: WorkLogEntry;
}

export interface AgentActivityTimelineState {
  timelineWorkEntries: WorkLogEntry[];
  detailById: Map<string, AgentActivityDetail>;
}

export function createAgentActivityTimelineSelector() {
  let previous: AgentActivityTimelineState = { timelineWorkEntries: [], detailById: new Map() };
  return (entries: ReadonlyArray<WorkLogEntry>): AgentActivityTimelineState => {
    const next = deriveAgentActivityTimelineState(entries);
    const previousEntries = new Map(previous.timelineWorkEntries.map((entry) => [entry.id, entry]));
    next.timelineWorkEntries = next.timelineWorkEntries.map((entry) => {
      const existing = previousEntries.get(entry.id);
      return existing && deepEqualJson(existing, entry) ? existing : entry;
    });
    for (const [id, detail] of next.detailById) {
      const existing = previous.detailById.get(id);
      if (existing && deepEqualJson(existing, detail)) next.detailById.set(id, existing);
    }
    if (
      next.timelineWorkEntries.length === previous.timelineWorkEntries.length &&
      next.timelineWorkEntries.every(
        (entry, index) => entry === previous.timelineWorkEntries[index],
      ) &&
      next.detailById.size === previous.detailById.size &&
      [...next.detailById].every(([id, detail]) => detail === previous.detailById.get(id))
    ) {
      return previous;
    }
    previous = next;
    return next;
  };
}

// A command row whose command has not arrived yet: Claude opens a tool call before its input
// streams in, and Codex reports bare command execution status.
export function isStatusOnlyCommandWorkEntry(entry: WorkLogEntry): boolean {
  const isStatusOnlyCommand =
    entry.itemType === "command_execution" && !entry.command && !entry.rawCommand;
  return (
    isStatusOnlyCommand || normalizeWorkText(entry.toolTitle ?? entry.label) === "command execution"
  );
}

export function isPlainRuntimeNoticeWorkEntry(
  entry: Pick<
    WorkLogEntry,
    "activityKind" | "nativeEventType" | "providerContextLifecycle" | "monitorNotification"
  >,
): boolean {
  return (
    entry.activityKind === "runtime.warning" &&
    !entry.providerContextLifecycle &&
    !entry.monitorNotification
  );
}

function isAgentActivityWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.monitorNotification) return false;
  return (
    entry.itemType === "collab_agent_tool_call" ||
    entry.activityKind === "runtime.warning" ||
    entry.activityKind === "tool.summary" ||
    entry.activityKind === "provider.transition"
  );
}

export function formatAgentActivityEntryPreview(entry: WorkLogEntry): string | null {
  if (entry.itemType === "collab_agent_tool_call") {
    return (
      normalizeOptionalText(entry.detail) ??
      normalizeOptionalText(entry.preview) ??
      normalizeOptionalText(entry.subagentAction?.prompt) ??
      normalizeOptionalText(entry.subagentAction?.summaryText)
    );
  }

  return normalizeOptionalText(entry.preview) ?? normalizeOptionalText(entry.detail);
}

function deriveAgentActivityTimelineState(
  entries: ReadonlyArray<WorkLogEntry>,
): AgentActivityTimelineState {
  const detailById = new Map<string, AgentActivityDetail>();
  for (const entry of entries) {
    if (isAgentActivityWorkEntry(entry)) {
      detailById.set(entry.id, { id: entry.id, entry });
    }
  }
  return { timelineWorkEntries: [...entries], detailById };
}

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkText(value: string): string {
  return normalizeCompactToolLabel(value).toLowerCase().replace(/\s+/g, " ").trim();
}
