import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { formatEffortLabel } from "@glade/shared/provider/effortLabel";

import type { WorkLogEntry, WorkLogSubagent } from "../../workLog.types";
import {
  formatSubagentModelLabel,
  humanizeSubagentStatus,
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
  type SubagentStatusKind,
} from "../../lib/subagentPresentation";

// One row per subagent a thread launched, merged across every call that mentioned it. The
// Environment panel lists them and the background shortcut acts on the running ones.
export interface SubagentRosterItem {
  key: string;
  threadId: ThreadId;
  providerThreadId: string;
  primaryLabel: string;
  modelLabel: string | undefined;
  statusLabel: string | undefined;
  statusKind: SubagentStatusKind | null;
  isActive: boolean;
  isBackground: boolean;
}

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

function toRosterItem(
  key: string,
  subagent: WorkLogSubagent,
  backgroundedThreadIds: ReadonlySet<string>,
): SubagentRosterItem {
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
  return {
    key,
    threadId: ThreadId.makeUnsafe(subagent.resolvedThreadId ?? subagent.threadId),
    providerThreadId: subagent.providerThreadId ?? subagent.threadId,
    primaryLabel: presentation.nickname ?? presentation.primaryLabel,
    modelLabel:
      modelLabel && effortLabel ? `${modelLabel} · ${effortLabel}` : (modelLabel ?? effortLabel),
    statusLabel,
    statusKind,
    isActive: statusKind === "running",
    isBackground:
      subagent.background === true ||
      backgroundedThreadIds.has(subagent.providerThreadId ?? subagent.threadId),
  };
}

export function collectForegroundRunningSubagentRosterItems(
  items: ReadonlyArray<SubagentRosterItem>,
): SubagentRosterItem[] {
  return items.filter((item) => item.isActive && !item.isBackground);
}

const NO_BACKGROUNDED_THREAD_IDS: ReadonlySet<string> = new Set();

export function deriveSubagentRosterItems(input: {
  workEntries: ReadonlyArray<WorkLogEntry>;
  backgroundedProviderThreadIds?: ReadonlySet<string>;
}): SubagentRosterItem[] {
  const backgroundedThreadIds = input.backgroundedProviderThreadIds ?? NO_BACKGROUNDED_THREAD_IDS;
  const subagentByKey = new Map<string, WorkLogSubagent>();
  for (const entry of input.workEntries) {
    for (const subagent of entry.subagents ?? []) {
      const key = subagentKey(subagent);
      const previous = subagentByKey.get(key);
      subagentByKey.set(key, previous ? mergeSubagentSnapshots(previous, subagent) : subagent);
    }
  }
  return [...subagentByKey.entries()].map(([key, subagent]) =>
    toRosterItem(key, subagent, backgroundedThreadIds),
  );
}
