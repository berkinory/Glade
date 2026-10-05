import { ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";

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
  const reportedModelLabel = formatSubagentModelLabel(subagent.model);
  const modelLabel =
    reportedModelLabel && subagent.modelIsRequestedHint
      ? `Requested: ${reportedModelLabel}`
      : reportedModelLabel;
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
      modelLabel && subagent.effort
        ? `${modelLabel} · ${subagent.effort}`
        : (modelLabel ?? subagent.effort),
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
  completedTurns: ReadonlyMap<TurnId, number>,
): ComposerSubagentStripItem[] {
  const subagentByKey = new Map<string, WorkLogSubagent>();
  const lastUseByKey = new Map<string, { at: number; turnId: TurnId | null }>();
  const inactiveSinceByKey = new Map<string, number>();
  for (const entry of entries) {
    for (const subagent of entry.subagents ?? []) {
      const key = subagentKey(subagent);
      const previous = subagentByKey.get(key);
      subagentByKey.set(key, previous ? mergeSubagentSnapshots(previous, subagent) : subagent);
      const at = Date.parse(entry.createdAt);
      const action = entry.subagentAction?.tool.toLowerCase().replace(/[^a-z]/g, "");
      if (
        !previous ||
        action === "spawnagent" ||
        action === "sendinput" ||
        action === "resumeagent"
      ) {
        lastUseByKey.set(key, { at, turnId: entry.turnId ?? null });
      }
      const terminal = normalizeSubagentStatusKind(subagent.rawStatus);
      if (
        (terminal === "completed" || terminal === "failed" || terminal === "stopped") &&
        terminal !== normalizeSubagentStatusKind(previous?.rawStatus)
      ) {
        inactiveSinceByKey.set(key, at);
      }
    }
  }
  return [...subagentByKey.entries()].flatMap(([key, subagent]) => {
    const item = toStripItem(key, subagent, backgroundedThreadIds, viewedThreadId);
    if (item.isActive || item.statusKind === "queued" || subagent.hasPendingInteraction)
      return [item];
    const lastUse = lastUseByKey.get(key)!;
    const inactiveSince = Math.max(
      lastUse.at,
      inactiveSinceByKey.get(key) ?? 0,
      subagent.lastCompletedAt ? Date.parse(subagent.lastCompletedAt) : 0,
    );
    // Metadata, waiting and duplicate completion events never reset the inactivity window.
    const idleTurns = [...completedTurns].filter(
      ([turnId, completedAt]) => turnId !== lastUse.turnId && completedAt > inactiveSince,
    ).length;
    return idleTurns < 3 ? [item] : [];
  });
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

export function deriveComposerSubagentStripItems(input: {
  workEntries: ReadonlyArray<WorkLogEntry>;
  parentActivities: ReadonlyArray<OrchestrationThreadActivity>;

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
  const completedTurns = new Map<TurnId, number>();
  for (const activity of input.parentActivities) {
    if (
      activity.kind === "turn.completed" &&
      activity.turnId &&
      asObjectRecord(activity.payload)?.state === "completed"
    ) {
      completedTurns.set(activity.turnId, Date.parse(activity.createdAt));
    }
  }

  const items = collectSubagentStripItems(
    entriesWithSubagents,
    backgroundedThreadIds,
    viewedThreadId,
    completedTurns,
  );
  return withParentRow(items, input.parentRow);
}
