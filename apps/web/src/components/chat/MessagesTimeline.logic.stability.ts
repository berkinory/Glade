import type { WorkLogEntry } from "../../workLog.types";
import type {
  CollapsedTurnItem,
  MessagesTimelineRow,
  StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic.rowTypes";
import { stringArraysEqual, workLogSubagentActionsEqual } from "./MessagesTimeline.logic.rows";

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

function workLogSubagentsEqual(
  left: WorkLogEntry["subagents"],
  right: WorkLogEntry["subagents"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((a, index) => {
    const b = right[index];
    return (
      b !== undefined &&
      a.threadId === b.threadId &&
      a.providerThreadId === b.providerThreadId &&
      a.resolvedThreadId === b.resolvedThreadId &&
      a.agentId === b.agentId &&
      a.nickname === b.nickname &&
      a.role === b.role &&
      a.model === b.model &&
      a.prompt === b.prompt &&
      a.rawStatus === b.rawStatus &&
      a.latestUpdate === b.latestUpdate &&
      a.title === b.title &&
      a.statusLabel === b.statusLabel &&
      a.isActive === b.isActive
    );
  });
}

function workLogGladeThreadCreationsEqual(
  a: WorkLogEntry["gladeThreadCreation"],
  b: WorkLogEntry["gladeThreadCreation"],
) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.operationId !== b.operationId ||
    a.requestedCount !== b.requestedCount ||
    a.createdCount !== b.createdCount ||
    a.threads.length !== b.threads.length
  ) {
    return false;
  }
  return a.threads.every((thread, index) => {
    const other = b.threads[index];
    return (
      other !== undefined &&
      thread.threadId === other.threadId &&
      thread.title === other.title &&
      thread.provider === other.provider &&
      thread.model === other.model &&
      thread.environment === other.environment &&
      thread.status === other.status
    );
  });
}

function workLogToolOutputsEqual(
  a: NonNullable<WorkLogEntry["toolDetails"]>["output"],
  b: NonNullable<WorkLogEntry["toolDetails"]>["output"],
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.output === b.output &&
    a.stdout === b.stdout &&
    a.stderr === b.stderr &&
    a.exitCode === b.exitCode &&
    a.truncated === b.truncated
  );
}

function workLogToolEditsEqual(
  left: NonNullable<WorkLogEntry["toolDetails"]>["edits"],
  right: NonNullable<WorkLogEntry["toolDetails"]>["edits"],
) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((edit, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      edit.path === other.path &&
      edit.oldText === other.oldText &&
      edit.newText === other.newText
    );
  });
}

function workLogToolDetailsEqual(a: WorkLogEntry["toolDetails"], b: WorkLogEntry["toolDetails"]) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    a.command === b.command &&
    a.diff === b.diff &&
    a.content === b.content &&
    stringArraysEqual(a.files, b.files) &&
    workLogToolOutputsEqual(a.output, b.output) &&
    workLogToolEditsEqual(a.edits, b.edits)
  );
}

function workLogLiveActivitiesEqual(
  a: WorkLogEntry["liveActivity"],
  b: WorkLogEntry["liveActivity"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.label === b.label &&
    a.startedAt === b.startedAt &&
    a.lastActivityAt === b.lastActivityAt &&
    a.detail === b.detail &&
    a.progress === b.progress &&
    a.elapsedSeconds === b.elapsedSeconds
  );
}

function workLogEntryContentEqual(a: WorkLogEntry, b: WorkLogEntry): boolean {
  return (
    a.id === b.id &&
    a.createdAt === b.createdAt &&
    a.turnId === b.turnId &&
    a.label === b.label &&
    a.detail === b.detail &&
    a.toolTitle === b.toolTitle &&
    a.command === b.command &&
    a.rawCommand === b.rawCommand &&
    a.preview === b.preview &&
    a.tone === b.tone &&
    a.itemType === b.itemType &&
    a.requestKind === b.requestKind &&
    a.activityKind === b.activityKind &&
    a.replySource?.threadId === b.replySource?.threadId &&
    a.replySource?.nickname === b.replySource?.nickname &&
    a.toolName === b.toolName &&
    a.toolCallId === b.toolCallId &&
    a.toolStatus === b.toolStatus &&
    stringArraysEqual(a.changedFiles, b.changedFiles) &&
    workLogSubagentActionsEqual(a.subagentAction, b.subagentAction) &&
    workLogSubagentsEqual(a.subagents, b.subagents) &&
    workLogGladeThreadCreationsEqual(a.gladeThreadCreation, b.gladeThreadCreation) &&
    workLogLiveActivitiesEqual(a.liveActivity, b.liveActivity) &&
    workLogToolDetailsEqual(a.toolDetails, b.toolDetails)
  );
}

function workLogEntryArraysEqual(
  left: ReadonlyArray<WorkLogEntry> | undefined,
  right: ReadonlyArray<WorkLogEntry> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => workLogEntryContentEqual(entry, right[index]!));
}

function collapsedTurnItemsEqual(
  left: ReadonlyArray<CollapsedTurnItem> | undefined,
  right: ReadonlyArray<CollapsedTurnItem> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index]!;
    if (item.kind !== other.kind || item.id !== other.id) return false;
    if (item.kind === "work" && other.kind === "work") {
      return workLogEntryContentEqual(item.entry, other.entry);
    }
    if (item.kind === "narration" && other.kind === "narration") {
      return item.message === other.message;
    }
    return false;
  });
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "visual-reply": {
      const visual = b as typeof a;
      return (
        a.createdAt === visual.createdAt &&
        a.reply.attachmentId === visual.reply.attachmentId &&
        a.reply.previewAttachmentId === visual.reply.previewAttachmentId &&
        a.reply.title === visual.reply.title
      );
    }
    case "turn-failure": {
      const failure = b as typeof a;
      return (
        a.createdAt === failure.createdAt &&
        a.turnId === failure.turnId &&
        a.message === failure.message
      );
    }
    case "working":
      return true;

    case "worktree-setup": {
      const bw = b as typeof a;
      return (
        a.open === bw.open &&
        a.steps.length === bw.steps.length &&
        a.steps.every((step, index) => {
          const other = bw.steps[index]!;
          return step.id === other.id && step.status === other.status && step.label === other.label;
        })
      );
    }

    case "work":
      return (
        a.createdAt === (b as typeof a).createdAt &&
        workLogEntryArraysEqual(a.groupedEntries, (b as typeof a).groupedEntries)
      );

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        workLogEntryArraysEqual(a.leadingWorkEntries, bm.leadingWorkEntries) &&
        a.leadingWorkGroupId === bm.leadingWorkGroupId &&
        workLogEntryArraysEqual(a.inlineWorkEntries, bm.inlineWorkEntries) &&
        a.inlineWorkGroupId === bm.inlineWorkGroupId &&
        collapsedTurnItemsEqual(a.collapsedTurnItems, bm.collapsedTurnItems) &&
        a.collapsedWorkElapsed === bm.collapsedWorkElapsed &&
        a.durationStart === bm.durationStart &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnInProgress === bm.assistantTurnInProgress &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary
      );
    }

    case "message-segment": {
      const bm = b as typeof a;
      return a.message === bm.message && a.segmentIndex === bm.segmentIndex;
    }
  }
}
