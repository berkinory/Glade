import type { MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { TimelineEntry, WorkLogEntry } from "../../workLog.types";
import { formatElapsed } from "../../session-logic";
import type { TurnDiffSummary, WorktreeSetupSnapshot } from "../../types";
import {
  type TimelineDurationMessage,
  computeMessageDurationStart,
  deriveTerminalAssistantMessageIds,
  findLastLiveWorkGroupId,
  mergeTurnDiffSummaries,
  planWorkEntryRenderChunks,
} from "./MessagesTimeline.logic.rowTypes";
import type { CollapsedTurnItem, MessagesTimelineRow } from "./MessagesTimeline.logic.rowTypes";

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  worktreeSetup: WorktreeSetupSnapshot | null;
  worktreeSetupOpen: boolean;
  activeTurnInProgress?: boolean;
  activeTurnId?: TurnId | null | undefined;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const timelineMessages = input.timelineEntries.flatMap<TimelineDurationMessage>((entry) =>
    entry.kind === "message"
      ? [entry.message]
      : entry.kind === "work" &&
          ["response.started", "provider.transition"].includes(entry.entry.activityKind ?? "")
        ? [{ id: entry.id, role: "user" as const, createdAt: entry.createdAt }]
        : [],
  );
  const durationStartByMessageId = computeMessageDurationStart(timelineMessages);
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(timelineMessages);
  let pendingWorkGroup: Extract<MessagesTimelineRow, { kind: "work" }> | null = null;

  const groupedEntriesEqual = (
    left: ReadonlyArray<WorkLogEntry>,
    right: ReadonlyArray<WorkLogEntry>,
  ) => left.length === right.length && left.every((entry, index) => entry === right[index]);

  const appendWorkEntriesToPreviousAssistant = (
    groupedEntries: WorkLogEntry[],
    groupId: string,
  ): boolean => {
    const previousRow = nextRows.at(-1);
    if (
      !previousRow ||
      previousRow.kind !== "message" ||
      previousRow.message.role !== "assistant"
    ) {
      return false;
    }

    const nextInlineWorkEntries = previousRow.inlineWorkEntries
      ? [...previousRow.inlineWorkEntries, ...groupedEntries]
      : groupedEntries;

    if (groupedEntriesEqual(previousRow.inlineWorkEntries ?? [], nextInlineWorkEntries)) {
      return true;
    }

    previousRow.inlineWorkEntries = nextInlineWorkEntries;
    previousRow.inlineWorkGroupId ??= groupId;
    return true;
  };

  const flushPendingWorkGroup = (options?: { attachToPreviousAssistant?: boolean }) => {
    if (!pendingWorkGroup) return;
    const shouldAttachToPreviousAssistant = options?.attachToPreviousAssistant ?? true;
    if (
      !shouldAttachToPreviousAssistant ||
      !appendWorkEntriesToPreviousAssistant(pendingWorkGroup.groupedEntries, pendingWorkGroup.id)
    ) {
      nextRows.push(pendingWorkGroup);
    }
    pendingWorkGroup = null;
  };

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      if (
        ["response.started", "provider.transition"].includes(timelineEntry.entry.activityKind ?? "")
      ) {
        flushPendingWorkGroup();
        nextRows.push({
          kind: "work",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          groupedEntries: [timelineEntry.entry],
        });
        continue;
      }
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (
          !nextEntry ||
          nextEntry.kind !== "work" ||
          ["response.started", "provider.transition"].includes(nextEntry.entry.activityKind ?? "")
        )
          break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      flushPendingWorkGroup();
      pendingWorkGroup = {
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      };
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "message-segment") {
      flushPendingWorkGroup({ attachToPreviousAssistant: false });
      nextRows.push({
        kind: "message-segment",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        message: timelineEntry.message,
        segmentIndex: timelineEntry.segmentIndex,
      });
      continue;
    }

    const message = timelineEntry.message;
    const leadingWorkEntries =
      message.role === "assistant" ? pendingWorkGroup?.groupedEntries : undefined;
    const leadingWorkGroupId = message.role === "assistant" ? pendingWorkGroup?.id : undefined;
    if (message.role === "assistant") {
      pendingWorkGroup = null;
    } else {
      flushPendingWorkGroup();
    }

    const assistantTurnStillInProgress =
      message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      message.turnId === input.activeTurnId;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message,
      ...(leadingWorkEntries ? { leadingWorkEntries } : {}),
      ...(leadingWorkGroupId ? { leadingWorkGroupId } : {}),
      durationStart: durationStartByMessageId.get(message.id) ?? message.createdAt,
      showAssistantCopyButton:
        message.role === "assistant" && terminalAssistantMessageIds.has(message.id),
      assistantCopyStreaming: message.streaming || assistantTurnStillInProgress,
      assistantTurnInProgress: assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(message.id)
          : undefined,
    });
  }

  flushPendingWorkGroup();

  if (input.worktreeSetup) {
    nextRows.push({
      kind: "worktree-setup",
      id: "worktree-setup-row",
      steps: input.worktreeSetup.steps,
      open: input.worktreeSetupOpen,
    });
  }

  const tailEntry = input.timelineEntries.at(-1);
  const tailHasAssistantText =
    (tailEntry?.kind === "message" || tailEntry?.kind === "message-segment") &&
    tailEntry.message.role === "assistant" &&
    (input.activeTurnId == null || tailEntry.message.turnId === input.activeTurnId) &&
    (tailEntry.kind === "message-segment"
      ? (tailEntry.message.textSegments?.[tailEntry.segmentIndex]?.text ?? tailEntry.message.text)
      : tailEntry.message.text
    ).trim().length > 0;
  const lastLiveWorkGroupId = findLastLiveWorkGroupId(nextRows);
  const hasLiveToolGroup = nextRows.some((row) => {
    const groups =
      row.kind === "work"
        ? [{ entries: row.groupedEntries, id: row.id }]
        : row.kind === "message"
          ? [
              { entries: row.leadingWorkEntries ?? [], id: null },
              { entries: row.inlineWorkEntries ?? [], id: row.inlineWorkGroupId },
            ]
          : [];
    return groups.some(({ entries, id }) =>
      planWorkEntryRenderChunks(entries, {
        tailIsLive: input.isWorking && id != null && id === lastLiveWorkGroupId,
      }).some((chunk) => chunk.liveEntry !== null),
    );
  });
  if (
    input.isWorking &&
    !tailHasAssistantText &&
    !hasLiveToolGroup &&
    !(input.worktreeSetup && input.worktreeSetupOpen)
  ) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
    });
  }

  collapseSettledTurns(nextRows, {
    terminalAssistantMessageIds,
    activeTurnInProgress: input.activeTurnInProgress ?? false,
    activeTurnId: input.activeTurnId ?? null,
  });

  return nextRows;
}

function findTailTerminalAssistantMessageId(
  rows: ReadonlyArray<MessagesTimelineRow>,
  terminalAssistantMessageIds: ReadonlySet<string>,
): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (
      row.kind === "work" &&
      row.groupedEntries.some((entry) =>
        ["response.started", "provider.transition"].includes(entry.activityKind ?? ""),
      )
    )
      return null;
    if (row.kind !== "message") {
      continue;
    }
    return row.message.role === "assistant" && terminalAssistantMessageIds.has(row.message.id)
      ? row.message.id
      : null;
  }
  return null;
}

function collapseSettledTurns(
  rows: MessagesTimelineRow[],
  options: {
    terminalAssistantMessageIds: ReadonlySet<string>;
    activeTurnInProgress: boolean;
    activeTurnId: TurnId | null;
  },
): void {
  const { terminalAssistantMessageIds, activeTurnInProgress, activeTurnId } = options;
  const lastTerminalAssistantMessageId = activeTurnInProgress
    ? findTailTerminalAssistantMessageId(rows, terminalAssistantMessageIds)
    : null;

  const collectWorkItems = (entries: ReadonlyArray<WorkLogEntry>, into: CollapsedTurnItem[]) => {
    for (const entry of entries) {
      into.push({ kind: "work", id: entry.id, entry });
    }
  };

  const earliestTimestamp = (a: string, b: string): string => {
    const aMs = Date.parse(a);
    const bMs = Date.parse(b);
    if (Number.isNaN(aMs)) return b;
    if (Number.isNaN(bMs)) return a;
    return bMs < aMs ? b : a;
  };

  for (let pass = rows.length - 1; pass >= 0; pass -= 1) {
    const row = rows[pass]!;
    if (row.kind !== "message" || row.message.role !== "assistant") continue;
    const message = row.message;
    if (message.asyncUserInput) continue;

    if (!terminalAssistantMessageIds.has(message.id)) continue;

    if (message.streaming) continue;
    const turnId = message.turnId ?? null;
    const turnIsActive =
      activeTurnInProgress &&
      (activeTurnId != null
        ? (turnId != null && turnId === activeTurnId) ||
          message.id === lastTerminalAssistantMessageId
        : message.id === lastTerminalAssistantMessageId);
    if (turnIsActive) continue;

    const foldIndices: number[] = [];
    for (let scan = pass - 1; scan >= 0; scan -= 1) {
      const prev = rows[scan]!;
      if (prev.kind === "work") {
        if (
          prev.groupedEntries.some((entry) =>
            ["response.started", "provider.transition"].includes(entry.activityKind ?? ""),
          )
        )
          break;
        foldIndices.push(scan);
        continue;
      }
      if (prev.kind === "message" && prev.message.role === "assistant") {
        if (
          prev.message.asyncUserInput ||
          terminalAssistantMessageIds.has(prev.message.id) ||
          (prev.message.turnId && turnId && prev.message.turnId !== turnId)
        )
          break;
        foldIndices.push(scan);
        continue;
      }

      if (prev.kind === "message-segment" && !prev.message.streaming) {
        if (prev.message.turnId && turnId && prev.message.turnId !== turnId) break;
        foldIndices.push(scan);
        continue;
      }

      break;
    }
    foldIndices.reverse();

    const collapsedItems: CollapsedTurnItem[] = [];

    let collapsedStart = row.durationStart;

    const foldedSegmentMessageIds = new Set<string>();
    for (const index of foldIndices) {
      const folded = rows[index]!;
      if (folded.kind === "work") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.createdAt);
        collectWorkItems(folded.groupedEntries, collapsedItems);
      } else if (folded.kind === "message-segment") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.createdAt);
        if (!foldedSegmentMessageIds.has(folded.message.id)) {
          foldedSegmentMessageIds.add(folded.message.id);
          collapsedItems.push({
            kind: "narration",
            id: folded.message.id,
            message: folded.message,
          });
        }
      } else if (folded.kind === "message" && folded.message.role === "assistant") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.durationStart);
        if (folded.assistantTurnDiffSummary) {
          row.assistantTurnDiffSummary = mergeTurnDiffSummaries(
            folded.assistantTurnDiffSummary,
            row.assistantTurnDiffSummary ?? folded.assistantTurnDiffSummary,
          );
        }
        if (folded.leadingWorkEntries) collectWorkItems(folded.leadingWorkEntries, collapsedItems);
        if (folded.collapsedTurnItems) collapsedItems.push(...folded.collapsedTurnItems);
        collapsedItems.push({ kind: "narration", id: folded.message.id, message: folded.message });
        if (folded.inlineWorkEntries) collectWorkItems(folded.inlineWorkEntries, collapsedItems);
      }
    }

    if (row.leadingWorkEntries) collectWorkItems(row.leadingWorkEntries, collapsedItems);
    if (row.inlineWorkEntries) collectWorkItems(row.inlineWorkEntries, collapsedItems);

    if (collapsedItems.length > 0) {
      const elapsed = formatElapsed(collapsedStart, message.completedAt);
      row.collapsedTurnItems = collapsedItems;
      row.collapsedWorkElapsed = elapsed ?? null;
      delete row.leadingWorkEntries;
      delete row.leadingWorkGroupId;
      delete row.inlineWorkEntries;
      delete row.inlineWorkGroupId;

      for (const index of foldIndices.toSorted((a, b) => b - a)) {
        rows.splice(index, 1);
      }
      pass -= foldIndices.length;
    }
  }
}

export function stringArraysEqual(
  left: ReadonlyArray<string> | undefined,
  right: ReadonlyArray<string> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function workLogSubagentActionsEqual(
  a: WorkLogEntry["subagentAction"],
  b: WorkLogEntry["subagentAction"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.tool === b.tool &&
    a.status === b.status &&
    a.summaryText === b.summaryText &&
    a.model === b.model &&
    a.prompt === b.prompt
  );
}
