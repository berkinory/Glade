import { ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { formatEffortLabel } from "@glade/shared/provider/effortLabel";

import type { WorkLogEntry, WorkLogSubagent } from "../../workLog.types";
import {
  formatSubagentModelLabel,
  humanizeSubagentStatus,
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
  type SubagentStatusKind,
} from "../../lib/subagentPresentation";

export interface ComposerSubagentStripItem {
  kind: "subagent";
  key: string;
  threadId: ThreadId;

  providerThreadId: string;
  primaryLabel: string;
  fullLabel: string;
  role: string | null;
  task: string | undefined;
  latestUpdate: string | undefined;
  modelLabel: string | undefined;
  statusLabel: string | undefined;
  statusKind: SubagentStatusKind | null;
  isActive: boolean;

  isViewed: boolean;
  isBackground: boolean;
  accentColor: string;
}

interface ComposerSubagentStripParentItem {
  kind: "parent";
  key: string;
  threadId: ThreadId;
  label: string;
}

export type ComposerSubagentStripRow = ComposerSubagentStripItem | ComposerSubagentStripParentItem;

function subagentKey(subagent: WorkLogSubagent): string {
  return subagent.threadId;
}

function mergeSubagentSnapshots(previous: WorkLogSubagent, next: WorkLogSubagent): WorkLogSubagent {
  const useNextModel =
    next.model && !(next.modelIsRequestedHint && previous.model && !previous.modelIsRequestedHint);
  return {
    threadId: next.threadId ?? previous.threadId,
    providerThreadId: next.providerThreadId ?? previous.providerThreadId,
    resolvedThreadId: next.resolvedThreadId ?? previous.resolvedThreadId,
    agentId: next.agentId ?? previous.agentId,
    nickname: next.nickname ?? previous.nickname,
    role: next.role ?? previous.role,
    model: useNextModel ? next.model : previous.model,
    modelIsRequestedHint: useNextModel ? next.modelIsRequestedHint : previous.modelIsRequestedHint,
    effort: next.effort ?? previous.effort,
    background: next.background ?? previous.background,
    prompt: next.prompt ?? previous.prompt,
    title: next.title ?? previous.title,
    latestUpdate: next.latestUpdate ?? previous.latestUpdate,
    rawStatus: next.rawStatus ?? previous.rawStatus,
    statusLabel: next.statusLabel ?? previous.statusLabel,
    isActive: next.isActive ?? previous.isActive,
    lastCompletedAt: next.lastCompletedAt ?? previous.lastCompletedAt,
    hasPendingInteraction: next.hasPendingInteraction ?? previous.hasPendingInteraction,
  };
}

function toStripItem(
  key: string,
  subagent: WorkLogSubagent,
  backgroundedThreadIds: ReadonlySet<string>,
  viewedThreadId: ThreadId | null,
): ComposerSubagentStripItem {
  const presentation = resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
    fallbackId: subagent.threadId,
  });
  const statusLabel =
    subagent.statusLabel ?? humanizeSubagentStatus(subagent.rawStatus, subagent.isActive);
  const statusKind = normalizeSubagentStatusKind(
    statusLabel ?? subagent.rawStatus,
    subagent.isActive,
  );
  const modelLabel = formatSubagentModelLabel(subagent.model);
  const effortLabel = subagent.effort ? formatEffortLabel(subagent.effort) : undefined;
  const threadId = ThreadId.makeUnsafe(subagent.resolvedThreadId ?? subagent.threadId);

  return {
    kind: "subagent",
    key,
    threadId,
    providerThreadId: subagent.providerThreadId ?? subagent.threadId,
    primaryLabel: presentation.nickname ?? presentation.primaryLabel,
    fullLabel: presentation.fullLabel,
    role: presentation.role,
    task: subagent.prompt,
    latestUpdate: subagent.latestUpdate,
    modelLabel:
      modelLabel && effortLabel ? `${modelLabel} · ${effortLabel}` : (modelLabel ?? effortLabel),
    statusLabel,
    statusKind,
    isActive: statusKind === "running",
    isViewed: viewedThreadId !== null && threadId === viewedThreadId,

    isBackground:
      subagent.background === true ||
      backgroundedThreadIds.has(subagent.providerThreadId ?? subagent.threadId),
    accentColor: presentation.accentColor,
  };
}

function collectSubagentStripItems(
  entries: ReadonlyArray<WorkLogEntry>,
  backgroundedThreadIds: ReadonlySet<string>,
  viewedThreadId: ThreadId | null,
): ComposerSubagentStripItem[] {
  const subagentByKey = new Map<string, WorkLogSubagent>();
  for (const entry of entries) {
    for (const subagent of entry.subagents ?? []) {
      const key = subagentKey(subagent);
      const previous = subagentByKey.get(key);
      subagentByKey.set(key, previous ? mergeSubagentSnapshots(previous, subagent) : subagent);
    }
  }
  return [...subagentByKey.entries()].map(([key, subagent]) =>
    toStripItem(key, subagent, backgroundedThreadIds, viewedThreadId),
  );
}

export function collectRunningSubagentStripItems(
  rows: ReadonlyArray<ComposerSubagentStripRow>,
): ComposerSubagentStripItem[] {
  return rows.filter(
    (row): row is ComposerSubagentStripItem => row.kind === "subagent" && row.isActive,
  );
}

export function collectForegroundRunningSubagentStripItems(
  rows: ReadonlyArray<ComposerSubagentStripRow>,
): ComposerSubagentStripItem[] {
  return collectRunningSubagentStripItems(rows).filter((row) => !row.isBackground);
}

const NO_BACKGROUNDED_THREAD_IDS: ReadonlySet<string> = new Set();

function withParentRow(
  items: ComposerSubagentStripItem[],
  parentRow: { threadId: ThreadId; label: string | null } | null | undefined,
): ComposerSubagentStripRow[] {
  if (items.length === 0 || !parentRow) {
    return items;
  }
  return [
    {
      kind: "parent",
      key: `parent:${parentRow.threadId}`,
      threadId: parentRow.threadId,
      label: parentRow.label ?? "Main thread",
    },
    ...items,
  ];
}

// The strip follows the live turn: its own subagents plus any still running from earlier turns.
// Without a live turn it stays only while something is still running, then retires; the
// Environment panel keeps the full history.
export function deriveComposerSubagentStripItems(input: {
  workEntries: ReadonlyArray<WorkLogEntry>;
  liveTurnId?: TurnId | null | undefined;

  backgroundedProviderThreadIds?: ReadonlySet<string>;

  viewedThreadId?: ThreadId | null;

  parentRow?: { threadId: ThreadId; label: string | null } | null;
}): ComposerSubagentStripRow[] {
  const entriesWithSubagents = input.workEntries.filter(
    (entry) => (entry.subagents?.length ?? 0) > 0,
  );
  if (entriesWithSubagents.length === 0) {
    return [];
  }

  const backgroundedThreadIds = input.backgroundedProviderThreadIds ?? NO_BACKGROUNDED_THREAD_IDS;
  const viewedThreadId = input.viewedThreadId ?? null;

  const items = collectSubagentStripItems(
    entriesWithSubagents,
    backgroundedThreadIds,
    viewedThreadId,
  );
  if (input.liveTurnId === undefined) return withParentRow(items, input.parentRow);
  const liveTurnKeys = new Set(
    collectSubagentStripItems(
      entriesWithSubagents.filter((entry) => entry.turnId === input.liveTurnId),
      backgroundedThreadIds,
      viewedThreadId,
    ).map((item) => item.key),
  );
  const visible = items.filter((item) => liveTurnKeys.has(item.key) || item.isActive);
  return withParentRow(visible, input.parentRow);
}
