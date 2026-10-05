import type { MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { WorkLogEntry } from "../../workLog.types";
import { normalizeCompactToolLabel as normalizeCompactToolLabelValue } from "../../lib/toolCallLabel.presentations";
import {
  isSummarizableToolCallEntry,
  MIN_COLLAPSIBLE_TOOL_GROUP_SIZE,
  summarizeToolCallGroup,
  workEntryRowCount,
  type ToolCallGroupSummary,
} from "./toolCallGroup.logic";
import type { ChatMessage, TurnDiffSummary, WorktreeSetupStep } from "../../types";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export function canSubmitUserMessageEdit(input: {
  draft: string;
  allowEmpty: boolean;
  disabled: boolean;
}): boolean {
  return (input.allowEmpty || input.draft.trim().length > 0) && !input.disabled;
}

export type CollapsedTurnItem =
  | { kind: "work"; id: string; entry: WorkLogEntry }
  | { kind: "narration"; id: string; message: ChatMessage };

export type CollapsedTurnChunk =
  | { kind: "item"; item: CollapsedTurnItem }
  | { kind: "tool-group"; id: string; entries: WorkLogEntry[] };

type WorkEntryChunk =
  | { kind: "item"; id: string; entry: WorkLogEntry }
  | { kind: "tool-group"; id: string; entries: WorkLogEntry[] };

export function chunkCollapsedTurnItems(
  items: ReadonlyArray<CollapsedTurnItem>,
): CollapsedTurnChunk[] {
  const chunks: CollapsedTurnChunk[] = [];
  let pendingRun: Extract<CollapsedTurnItem, { kind: "work" }>[] = [];

  const flushPendingRun = () => {
    if (pendingRun.length === 0) return;
    const pendingRowCount = pendingRun.reduce(
      (total, item) => total + workEntryRowCount(item.entry),
      0,
    );
    if (pendingRowCount >= MIN_COLLAPSIBLE_TOOL_GROUP_SIZE) {
      chunks.push({
        kind: "tool-group",
        id: pendingRun[0]!.id,
        entries: pendingRun.map((item) => item.entry),
      });
    } else {
      for (const item of pendingRun) {
        chunks.push({ kind: "item", item });
      }
    }
    pendingRun = [];
  };

  for (const item of items) {
    if (item.kind === "work" && isSummarizableToolCallEntry(item.entry)) {
      pendingRun.push(item);
      continue;
    }
    flushPendingRun();
    chunks.push({ kind: "item", item });
  }
  flushPendingRun();
  return chunks;
}

function chunkWorkEntries(entries: ReadonlyArray<WorkLogEntry>): WorkEntryChunk[] {
  return chunkCollapsedTurnItems(
    entries.map((entry) => ({ kind: "work" as const, id: entry.id, entry })),
  ).map((chunk) => {
    if (chunk.kind === "tool-group") return chunk;
    if (chunk.item.kind !== "work") {
      throw new Error("Work-entry chunking produced an unexpected narration item.");
    }
    return { kind: "item", id: chunk.item.id, entry: chunk.item.entry };
  });
}

export interface WorkEntryRenderPlanChunk {
  id: string;
  entries: WorkLogEntry[];
  summary: ToolCallGroupSummary | null;
  liveEntry: WorkLogEntry | null;
}

function pickLiveToolEntry(entries: ReadonlyArray<WorkLogEntry>): WorkLogEntry {
  return entries.findLast((entry) => entry.toolStatus === "running") ?? entries.at(-1)!;
}

export function planWorkEntryRenderChunks(
  entries: ReadonlyArray<WorkLogEntry>,
  options: { tailIsLive: boolean },
): WorkEntryRenderPlanChunk[] {
  const chunks = chunkWorkEntries(entries);
  return chunks.map((chunk, index) => {
    const entries = chunk.kind === "item" ? [chunk.entry] : chunk.entries;
    const isLiveTail = options.tailIsLive && index === chunks.length - 1;
    const summary = summarizeToolCallGroup(entries, {
      includeSingleEntry: isLiveTail || entries.some((entry) => entry.toolStatus === "running"),
    });
    const collapsed = summary !== null && !summary.hasRunningEntry && !isLiveTail;
    return {
      id: chunk.id,
      entries,
      summary: collapsed ? summary : null,
      liveEntry: summary !== null && !collapsed ? pickLiveToolEntry(entries) : null,
    };
  });
}

export function isFoldedWorkEntryChunk(chunk: WorkEntryRenderPlanChunk): boolean {
  return chunk.summary !== null || chunk.liveEntry !== null;
}

export function resolveWorkEntryChunkFold(
  chunk: WorkEntryRenderPlanChunk,
): { summary: ToolCallGroupSummary; entries: WorkLogEntry[]; keySuffix: string } | null {
  if (chunk.summary !== null) {
    return { summary: chunk.summary, entries: chunk.entries, keySuffix: "" };
  }
  const liveSummary = chunk.liveEntry
    ? summarizeToolCallGroup(chunk.entries, { includeSingleEntry: true })
    : null;
  if (!liveSummary) return null;
  return {
    summary: liveSummary,

    entries: chunk.entries.filter(
      (entry) =>
        liveSummary.entryCount === 1 || entry !== chunk.liveEntry || workEntryRowCount(entry) > 1,
    ),
    keySuffix: ":live",
  };
}

export interface CappedWorkEntryRenderPlan {
  chunks: WorkEntryRenderPlanChunk[];
  hasOverflow: boolean;
  hiddenEntryCount: number;
}

export function capOpenWorkEntryRenderChunks(
  chunks: ReadonlyArray<WorkEntryRenderPlanChunk>,
  options: {
    expanded: boolean;
    maxVisibleEntries: number;
    keep: "first" | "last";
    shouldCapEntry?: (entry: WorkLogEntry) => boolean;
  },
): CappedWorkEntryRenderPlan {
  const shouldCapEntry = options.shouldCapEntry ?? (() => true);
  const openEntries = chunks.flatMap((chunk) =>
    isFoldedWorkEntryChunk(chunk) ? [] : chunk.entries.filter(shouldCapEntry),
  );
  const maxVisibleEntries = Math.max(0, options.maxVisibleEntries);
  const hiddenEntryCount = Math.max(0, openEntries.length - maxVisibleEntries);
  const hasOverflow = hiddenEntryCount > 0;

  if (!hasOverflow || options.expanded) {
    return { chunks: [...chunks], hasOverflow, hiddenEntryCount: 0 };
  }

  const visibleEntries =
    maxVisibleEntries === 0
      ? []
      : options.keep === "last"
        ? openEntries.slice(-maxVisibleEntries)
        : openEntries.slice(0, maxVisibleEntries);
  const visibleEntrySet = new Set(visibleEntries);

  return {
    chunks: chunks.map((chunk) => {
      if (isFoldedWorkEntryChunk(chunk)) return chunk;
      return {
        ...chunk,
        entries: chunk.entries.filter(
          (entry) => !shouldCapEntry(entry) || visibleEntrySet.has(entry),
        ),
      };
    }),
    hasOverflow,
    hiddenEntryCount,
  };
}

export function findLastLiveWorkGroupId(rows: ReadonlyArray<MessagesTimelineRow>): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "work") {
      return row.id;
    }
    if (row.kind === "message") {
      const groupId = row.inlineWorkGroupId ?? row.leadingWorkGroupId;
      if (groupId) {
        return groupId;
      }

      if (row.message.role === "user") {
        return null;
      }
    }
  }
  return null;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  turnId?: string | null;
  completedAt?: string | undefined;
}

interface TimelineDiffMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  turnId: TurnId | null;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      leadingWorkEntries?: WorkLogEntry[];
      leadingWorkGroupId?: string;
      inlineWorkEntries?: WorkLogEntry[];
      inlineWorkGroupId?: string;
      collapsedTurnItems?: CollapsedTurnItem[];
      collapsedWorkElapsed?: string | null;
      durationStart: string;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      // True while this row's turn is still running. The end-of-turn changes card (Undo / Review) is held
      // back until the turn settles so it cannot pre-empt the composer's live changes strip mid-turn.
      assistantTurnInProgress?: boolean | undefined;
    }
  | {
      kind: "message-segment";
      id: string;
      createdAt: string;
      message: ChatMessage;
      segmentIndex: number;
    }
  | { kind: "working"; id: string }
  | {
      kind: "worktree-setup";
      id: string;
      steps: ReadonlyArray<WorktreeSetupStep>;
      open: boolean;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export interface ThreadFindJumpTarget {
  rowIndex: number;
  visibleMessageId: MessageId;
  expandCollapsedWorkMessageId?: MessageId;
  collapsedNarrationMessageId?: MessageId;
}

export function resolveThreadFindJumpTarget(
  rows: readonly MessagesTimelineRow[],
  match: { messageId: MessageId; segmentIndex?: number },
): ThreadFindJumpTarget | null {
  const { messageId, segmentIndex } = match;
  if (segmentIndex !== undefined) {
    const segmentRowIndex = rows.findIndex(
      (row) =>
        row.kind === "message-segment" &&
        row.message.id === messageId &&
        row.segmentIndex === segmentIndex,
    );
    if (segmentRowIndex >= 0) {
      return { rowIndex: segmentRowIndex, visibleMessageId: messageId };
    }
  }

  const messageRowIndex = rows.findIndex(
    (row) => row.kind === "message" && row.message.id === messageId,
  );
  if (messageRowIndex >= 0) {
    return { rowIndex: messageRowIndex, visibleMessageId: messageId };
  }

  const anySegmentRowIndex = rows.findIndex(
    (row) => row.kind === "message-segment" && row.message.id === messageId,
  );
  if (anySegmentRowIndex >= 0) {
    return { rowIndex: anySegmentRowIndex, visibleMessageId: messageId };
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.kind !== "message" || row.message.role !== "assistant") {
      continue;
    }
    const hasNarration = (row.collapsedTurnItems ?? []).some(
      (item) => item.kind === "narration" && item.message.id === messageId,
    );
    if (!hasNarration) {
      continue;
    }
    return {
      rowIndex,
      visibleMessageId: row.message.id,
      expandCollapsedWorkMessageId: row.message.id,
      collapsedNarrationMessageId: messageId,
    };
  }

  return null;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return normalizeCompactToolLabelValue(value);
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const normalizedText = text?.trim() ? text : null;
  return {
    text: normalizedText,
    visible: showCopyButton && normalizedText !== null && !streaming,
  };
}

type AssistantMessageDisplayInput = {
  readonly message: Pick<ChatMessage, "text" | "streaming">;
  readonly leadingWorkEntries?: ReadonlyArray<WorkLogEntry>;
  readonly inlineWorkEntries?: ReadonlyArray<WorkLogEntry>;
  readonly collapsedTurnItems?: ReadonlyArray<CollapsedTurnItem>;
};

function isVisibleGeneratedImageEntry(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "image_generation" &&
    entry.activityKind === "tool.completed" &&
    entry.tone !== "error"
  );
}

// Resolves the markdown body for an assistant row. A completed image-generation work item is
// already visible non-text output, so an adjacent empty provider message must not add the
// misleading "(empty response)" placeholder.
export function resolveAssistantMessageDisplayText(
  input: AssistantMessageDisplayInput,
): string | null {
  if (input.message.text) {
    return input.message.text;
  }
  if (input.message.streaming) {
    return "";
  }

  const hasVisibleGeneratedImage = [
    ...(input.leadingWorkEntries ?? []),
    ...(input.inlineWorkEntries ?? []),
    ...(input.collapsedTurnItems ?? []).flatMap((item) =>
      item.kind === "work" ? [item.entry] : [],
    ),
  ].some(isVisibleGeneratedImageEntry);

  return hasVisibleGeneratedImage ? null : "(empty response)";
}

export function buildTurnDiffSummaryByAssistantMessageId(input: {
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  messages: ReadonlyArray<TimelineDiffMessage>;
}): Map<MessageId, TurnDiffSummary> {
  const byMessageId = new Map<MessageId, TurnDiffSummary>();
  if (input.turnDiffSummaries.length === 0) return byMessageId;

  const summaryByTurnId = new Map<string, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    summaryByTurnId.set(summary.turnId, summary);
  }

  const messageIndexByTurnId = new Map<string, number>();
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index]!;
    if (message.role !== "assistant" || !message.turnId) continue;
    messageIndexByTurnId.set(message.turnId, index);
  }

  for (const [turnId, summary] of summaryByTurnId) {
    const anchorIndex = messageIndexByTurnId.get(turnId);
    if (anchorIndex === undefined) continue;
    let terminalAssistantMessageId: MessageId | null = null;
    for (let index = anchorIndex; index < input.messages.length; index += 1) {
      const message = input.messages[index]!;
      if (
        index > anchorIndex &&
        (message.role === "user" || (message.turnId && message.turnId !== turnId))
      )
        break;
      if (message.role === "assistant") {
        terminalAssistantMessageId = message.id;
      }
    }
    if (!terminalAssistantMessageId) continue;

    byMessageId.set(
      terminalAssistantMessageId,
      mergeTurnDiffSummaries(byMessageId.get(terminalAssistantMessageId), summary),
    );
  }
  return byMessageId;
}

export function mergeTurnDiffSummaries(
  existing: TurnDiffSummary | undefined,
  next: TurnDiffSummary,
): TurnDiffSummary {
  const checkpointTurnCountsFor = (summary: TurnDiffSummary): number[] => {
    if (
      summary.files.length === 0 ||
      summary.status === "missing" ||
      summary.status === "error" ||
      summary.checkpointRef === undefined ||
      summary.checkpointRef.startsWith("provider-diff:")
    ) {
      return [];
    }
    return (
      summary.checkpointTurnCounts ??
      (summary.checkpointTurnCount === undefined ? [] : [summary.checkpointTurnCount])
    );
  };
  if (!existing) {
    const checkpointTurnCounts = checkpointTurnCountsFor(next);
    return { ...next, checkpointTurnCounts };
  }

  const filesByPath = new Map(existing.files.map((file) => [file.path, file]));
  for (const file of next.files) {
    filesByPath.set(file.path, file);
  }
  const checkpointTurnCounts = new Set([
    ...checkpointTurnCountsFor(existing),
    ...checkpointTurnCountsFor(next),
  ]);
  const undoMetadata =
    checkpointTurnCountsFor(next).length > 0
      ? next
      : checkpointTurnCountsFor(existing).length > 0
        ? existing
        : next;
  const allDisplayedFilesUndoable = [existing, next].every(
    (summary) => summary.files.length === 0 || checkpointTurnCountsFor(summary).length > 0,
  );

  return {
    ...next,
    files: [...filesByPath.values()],
    checkpointRef: undoMetadata.checkpointRef,
    status: undoMetadata.status,
    checkpointTurnCount: undoMetadata.checkpointTurnCount,
    checkpointTurnCounts: allDisplayedFilesUndoable
      ? [...checkpointTurnCounts].toSorted((left, right) => left - right)
      : [],
  };
}

export function deriveTerminalAssistantMessageIds(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Set<string> {
  const terminalAssistantMessageIds = new Set<string>();
  let latestAssistantMessageId: string | null = null;
  let latestAssistantTurnId: string | null = null;

  for (const message of messages) {
    if (message.role !== "assistant") {
      if (latestAssistantMessageId) {
        terminalAssistantMessageIds.add(latestAssistantMessageId);
        latestAssistantMessageId = null;
      }
      continue;
    }
    if (
      latestAssistantMessageId &&
      latestAssistantTurnId &&
      message.turnId &&
      latestAssistantTurnId !== message.turnId
    )
      terminalAssistantMessageIds.add(latestAssistantMessageId);
    latestAssistantMessageId = message.id;
    latestAssistantTurnId = message.turnId ?? null;
  }

  if (latestAssistantMessageId) {
    terminalAssistantMessageIds.add(latestAssistantMessageId);
  }

  return terminalAssistantMessageIds;
}
