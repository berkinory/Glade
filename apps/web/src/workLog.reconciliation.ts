import type {
  OrchestrationLatestTurnState,
  OrchestrationThreadActivity,
} from "@glade/contracts/orchestration/threadEntities";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import {
  isGenericToolTitle,
  normalizeCompactToolLabel,
  normalizeToolTextForComparison,
} from "./lib/toolCallLabel";
import { mergeWorkLogToolDetails } from "./lib/toolCallDetails";
import type {
  DerivedWorkLogEntry,
  WorkLogLiveActivity,
  WorkLogLiveActivityState,
} from "./workLog.types";
import { extractDetailCollapseHint } from "./workLog.extraction";

export function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];

  const stableToolIndexByKey = new Map<string, number>();

  const seenRuntimeReconciliationKeys = new Set<string>();

  const taskListIndexByKey = new Map<string, number>();
  for (const entry of entries) {
    const runtimeReconciliationKey = entry.collapseKey?.startsWith("provider-runtime-reconcile:")
      ? entry.collapseKey
      : undefined;
    if (runtimeReconciliationKey !== undefined) {
      if (seenRuntimeReconciliationKeys.has(runtimeReconciliationKey)) {
        continue;
      }
      seenRuntimeReconciliationKeys.add(runtimeReconciliationKey);
    }
    const taskListKey = entry.collapseKey?.startsWith("taskList:") ? entry.collapseKey : undefined;
    if (taskListKey !== undefined) {
      const existingIndex = taskListIndexByKey.get(taskListKey);
      if (existingIndex !== undefined) {
        collapsed[existingIndex] = mergeTaskListEntries(collapsed[existingIndex]!, entry);
        continue;
      }
      taskListIndexByKey.set(taskListKey, collapsed.length);
      collapsed.push(entry);
      continue;
    }
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseRuntimeWarningEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeRuntimeWarningEntries(previous, entry);
      continue;
    }
    if (previous && shouldCollapseContextCompactionEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      continue;
    }
    const stableToolKey =
      entry.collapseKey?.startsWith("tool:") &&
      isRenderableToolLifecycleActivity(entry.activityKind)
        ? entry.collapseKey
        : undefined;
    if (stableToolKey !== undefined) {
      const existingIndex = stableToolIndexByKey.get(stableToolKey);
      if (existingIndex !== undefined) {
        collapsed[existingIndex] = mergeDerivedWorkLogEntries(collapsed[existingIndex]!, entry);
        continue;
      }
    }
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      if (stableToolKey !== undefined) {
        stableToolIndexByKey.set(stableToolKey, collapsed.length - 1);
      }
      continue;
    }
    collapsed.push(entry);
    if (stableToolKey !== undefined) {
      stableToolIndexByKey.set(stableToolKey, collapsed.length - 1);
    }
  }
  return collapsed;
}

function shouldCollapseRuntimeWarningEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (previous.activityKind !== "runtime.warning" || next.activityKind !== "runtime.warning") {
    return false;
  }
  if (previous.turnId !== next.turnId) {
    return false;
  }
  return (
    normalizeToolTextForComparison(previous.label) === normalizeToolTextForComparison(next.label) &&
    normalizeToolTextForComparison(
      previous.runtimeWarningMessage ?? previous.detail ?? previous.preview ?? "",
    ) ===
      normalizeToolTextForComparison(
        next.runtimeWarningMessage ?? next.detail ?? next.preview ?? "",
      )
  );
}

function mergeRuntimeWarningEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const repeatCount = (previous.runtimeWarningRepeatCount ?? 1) + 1;
  const runtimeWarningMessage =
    next.runtimeWarningMessage ??
    previous.runtimeWarningMessage ??
    next.detail ??
    next.preview ??
    previous.detail ??
    previous.preview;
  const repeatPreview = runtimeWarningMessage
    ? `${repeatCount} notices - ${runtimeWarningMessage}`
    : `${repeatCount} notices`;
  return {
    ...previous,
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    runtimeWarningRepeatCount: repeatCount,
    ...(runtimeWarningMessage ? { runtimeWarningMessage } : {}),
    detail: repeatPreview,
    preview: repeatPreview,
  };
}

// A later task-list snapshot supersedes the earlier one wholesale (providers resend the full
// checklist), so keep the newest content while preserving the first row's id and createdAt: the id
// keeps React rows stable across updates and the createdAt keeps the row anchored where the
// checklist first appeared. A snapshot without readable tasks (explicit clear, or an unreadable
// payload) carries no progress copy, so it must not overwrite a progressed row with the generic
// "Tasks updated" label — keep the previous row's content instead.
function mergeTaskListEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  if (previous.taskListHasTasks && !next.taskListHasTasks) {
    return previous;
  }
  return {
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
  };
}

export function isContextCompactionProgressLabel(label: string): boolean {
  return label === "Compacting context" || label === "Compacting conversation...";
}

function shouldCollapseContextCompactionEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (
    previous.activityKind !== "context-compaction" ||
    next.activityKind !== "context-compaction"
  ) {
    return false;
  }
  if (previous.turnId !== next.turnId) {
    return false;
  }
  // Only merge into a row that is still in progress; a terminal row belongs to an earlier compaction
  // and must not swallow the next one's progress row.
  return isContextCompactionProgressLabel(previous.label);
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (!isRenderableToolLifecycleActivity(previous.activityKind)) {
    return false;
  }
  if (!isRenderableToolLifecycleActivity(next.activityKind)) {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.suppressStandaloneCommandStart && next.toolCallId === undefined) {
    return false;
  }
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    if (previous.collapseKey.startsWith("tool:")) {
      return true;
    }
    if (!areToolLifecycleChangedFilesCompatible(previous.changedFiles, next.changedFiles)) {
      return false;
    }
    return areToolLifecycleCommandsCompatible(previous.collapseCommand, next.collapseCommand);
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label) &&
    areToolLifecycleChangedFilesCompatible(previous.changedFiles, next.changedFiles) &&
    areToolLifecycleCommandsCompatible(previous.collapseCommand, next.collapseCommand)
  );
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const preview = next.preview ?? previous.preview;
  const toolTitle = mergeWorkLogToolTitle(previous, next);
  const preservePreviousToolSemantics =
    next.activityKind === "tool.updated" &&
    next.itemType === "mcp_tool_call" &&
    previous.itemType !== undefined &&
    previous.itemType !== "mcp_tool_call";
  const itemType = preservePreviousToolSemantics
    ? previous.itemType
    : (next.itemType ?? previous.itemType);
  const requestKind = preservePreviousToolSemantics
    ? previous.requestKind
    : (next.requestKind ?? previous.requestKind);
  const subagents = next.subagents ?? previous.subagents;
  const subagentAction = next.subagentAction ?? previous.subagentAction;
  const gladeThreadCreation = next.gladeThreadCreation ?? previous.gladeThreadCreation;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolName = next.toolName ?? previous.toolName;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const preservePreviousTerminalState =
    previous.liveActivity !== undefined &&
    !isInProgressLiveActivityState(previous.liveActivity.state) &&
    next.liveActivity !== undefined &&
    isInProgressLiveActivityState(next.liveActivity.state);
  const toolStatus = preservePreviousTerminalState
    ? previous.toolStatus
    : (next.toolStatus ?? previous.toolStatus);
  const liveActivity = mergeWorkLogLiveActivity(previous.liveActivity, next.liveActivity);
  const toolDetails = mergeWorkLogToolDetails(previous.toolDetails, next.toolDetails);

  const turnId = next.turnId ?? previous.turnId;
  return {
    ...previous,
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    ...(previous.sequence !== undefined ? { sequence: previous.sequence } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(preview ? { preview } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(subagents ? { subagents } : {}),
    ...(subagentAction ? { subagentAction } : {}),
    ...(gladeThreadCreation ? { gladeThreadCreation } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolStatus ? { toolStatus } : {}),
    ...(liveActivity ? { liveActivity } : {}),
    ...(toolDetails ? { toolDetails } : {}),
  };
}

function mergeWorkLogLiveActivity(
  previous: WorkLogLiveActivity | undefined,
  next: WorkLogLiveActivity | undefined,
): WorkLogLiveActivity | undefined {
  if (!previous) return next;
  if (!next) return previous;
  if (!isInProgressLiveActivityState(previous.state) && isInProgressLiveActivityState(next.state)) {
    return {
      ...previous,
      ...(next.detail || previous.detail ? { detail: next.detail ?? previous.detail } : {}),
      ...(next.progress !== undefined || previous.progress !== undefined
        ? { progress: next.progress ?? previous.progress }
        : {}),
    };
  }
  const startedAt = previous.startedAt ?? next.startedAt;
  const lifecycleElapsedSeconds = startedAt
    ? (Date.parse(next.lastActivityAt) - Date.parse(startedAt)) / 1_000
    : undefined;
  const activityDeltaSeconds =
    (Date.parse(next.lastActivityAt) - Date.parse(previous.lastActivityAt)) / 1_000;
  const carriedElapsedSeconds =
    next.elapsedSeconds === undefined &&
    previous.elapsedSeconds !== undefined &&
    Number.isFinite(activityDeltaSeconds)
      ? previous.elapsedSeconds + Math.max(0, activityDeltaSeconds)
      : previous.elapsedSeconds;
  const elapsedCandidates = [
    lifecycleElapsedSeconds,
    next.elapsedSeconds,
    carriedElapsedSeconds,
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));
  const terminalElapsedSeconds =
    next.state === "completed" || next.state === "failed" || next.state === "cancelled"
      ? elapsedCandidates.length > 0
        ? Math.max(0, ...elapsedCandidates)
        : undefined
      : undefined;
  return {
    state: next.state,
    label: next.label || previous.label,
    lastActivityAt: next.lastActivityAt,
    ...(startedAt ? { startedAt } : {}),
    ...(next.detail || previous.detail ? { detail: next.detail ?? previous.detail } : {}),
    ...(next.progress !== undefined || previous.progress !== undefined
      ? { progress: next.progress ?? previous.progress }
      : {}),
    ...(terminalElapsedSeconds !== undefined
      ? { elapsedSeconds: terminalElapsedSeconds }
      : next.elapsedSeconds !== undefined || carriedElapsedSeconds !== undefined
        ? { elapsedSeconds: next.elapsedSeconds ?? carriedElapsedSeconds }
        : {}),
  };
}

export function reconcileSettledLiveActivities(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  options: {
    activeTurnId?: TurnId | null;
    activeTurnStartedAt?: string | null;
    latestTurnState?: OrchestrationLatestTurnState | null;
    latestTurnCompletedAt?: string | null;
  },
): DerivedWorkLogEntry[] {
  const terminalByTurnId = new Map<
    TurnId | string,
    {
      state: Extract<WorkLogLiveActivityState, "completed" | "failed" | "cancelled">;
      settledAt: string;
    }
  >();
  for (const activity of activities) {
    if (activity.turnId === null) {
      continue;
    }
    if (activity.kind === "turn.aborted") {
      terminalByTurnId.set(activity.turnId, {
        state: "cancelled",
        settledAt: activity.createdAt,
      });
    } else if (activity.kind === "turn.completed") {
      terminalByTurnId.set(activity.turnId, {
        state: activity.tone === "error" ? "failed" : "completed",
        settledAt: activity.createdAt,
      });
    }
  }

  const latestTerminalState =
    options.latestTurnState === "completed"
      ? "completed"
      : options.latestTurnState === "error"
        ? "failed"
        : options.latestTurnState === "interrupted"
          ? "cancelled"
          : null;
  if (
    latestTurnId &&
    latestTerminalState &&
    options.latestTurnCompletedAt &&
    !terminalByTurnId.has(latestTurnId)
  ) {
    terminalByTurnId.set(latestTurnId, {
      state: latestTerminalState,
      settledAt: options.latestTurnCompletedAt,
    });
  }

  const hasActiveTurnContext = options.activeTurnId !== undefined;
  const activeTurnStartedAtMs = options.activeTurnStartedAt
    ? Date.parse(options.activeTurnStartedAt)
    : Number.NaN;
  return entries.map((entry) => {
    const liveActivity = entry.liveActivity;
    if (!liveActivity || !isInProgressLiveActivityState(liveActivity.state)) {
      return entry;
    }

    const terminal = entry.turnId ? terminalByTurnId.get(entry.turnId) : undefined;
    if (terminal) {
      return {
        ...entry,
        toolStatus:
          terminal.state === "failed"
            ? "failed"
            : terminal.state === "cancelled"
              ? "cancelled"
              : "completed",
        liveActivity: settleWorkLogLiveActivity(liveActivity, terminal.state, terminal.settledAt),
      };
    }

    if (!hasActiveTurnContext) {
      return entry;
    }
    const entryLastActivityAtMs = Date.parse(liveActivity.lastActivityAt);
    const turnlessEntryBelongsToActiveTurn =
      (entry.turnId === undefined || entry.turnId === null) &&
      Number.isFinite(activeTurnStartedAtMs) &&
      Number.isFinite(entryLastActivityAtMs) &&
      entryLastActivityAtMs >= activeTurnStartedAtMs;
    if (
      options.activeTurnId !== null &&
      (entry.turnId === options.activeTurnId || turnlessEntryBelongsToActiveTurn)
    ) {
      return entry;
    }

    const settledState =
      latestTurnId && entry.turnId === latestTurnId && latestTerminalState
        ? latestTerminalState
        : "cancelled";
    return {
      ...entry,
      toolStatus:
        settledState === "failed"
          ? "failed"
          : settledState === "cancelled"
            ? "cancelled"
            : "completed",
      liveActivity: settleWorkLogLiveActivity(
        liveActivity,
        settledState,
        latestTurnId && entry.turnId === latestTurnId && options.latestTurnCompletedAt
          ? options.latestTurnCompletedAt
          : liveActivity.lastActivityAt,
      ),
    };
  });
}

function isInProgressLiveActivityState(state: WorkLogLiveActivityState): boolean {
  return (
    state === "starting" ||
    state === "thinking" ||
    state === "running_tool" ||
    state === "waiting" ||
    state === "streaming"
  );
}

function settleWorkLogLiveActivity(
  activity: WorkLogLiveActivity,
  state: Extract<WorkLogLiveActivityState, "completed" | "failed" | "cancelled">,
  settledAt: string,
): WorkLogLiveActivity {
  const activityAtMs = Date.parse(activity.lastActivityAt);
  const settledAtMs = Date.parse(settledAt);
  const lastActivityAt =
    Number.isFinite(activityAtMs) && Number.isFinite(settledAtMs) && settledAtMs >= activityAtMs
      ? settledAt
      : activity.lastActivityAt;
  return (
    mergeWorkLogLiveActivity(activity, {
      state,
      label: activity.label,
      lastActivityAt,
    }) ?? activity
  );
}

function mergeWorkLogToolTitle(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): string | undefined {
  const previousTitle = previous.toolTitle;
  const nextTitle = next.toolTitle;
  if (!previousTitle || !nextTitle) {
    return nextTitle ?? previousTitle;
  }
  const isAgentTask =
    previous.itemType === "collab_agent_tool_call" || next.itemType === "collab_agent_tool_call";
  if (isAgentTask && !isGenericToolTitle(previousTitle) && isGenericToolTitle(nextTitle)) {
    return previousTitle;
  }
  return nextTitle;
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

export function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (!isRenderableToolLifecycleActivity(entry.activityKind)) {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const itemType = entry.itemType ?? "";
  const requestKind = entry.requestKind ?? "";
  const toolName = entry.toolName ?? "";
  const command = normalizeCompactToolLabel(entry.command ?? "");
  const detailHint = normalizeCompactToolLabel(extractDetailCollapseHint(entry.detail));
  if (
    normalizedLabel.length === 0 &&
    itemType.length === 0 &&
    requestKind.length === 0 &&
    toolName.length === 0 &&
    detailHint.length === 0
  ) {
    return command.length > 0 ? `command-only${"\u001f"}${command}` : undefined;
  }
  return [itemType, normalizedLabel, requestKind, toolName, detailHint].join("\u001f");
}

export function isRenderableToolLifecycleActivity(
  kind: OrchestrationThreadActivity["kind"],
): kind is "tool.started" | "tool.updated" | "tool.completed" {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

export function deriveToolLifecycleCollapseCommand(entry: DerivedWorkLogEntry): string | undefined {
  const command = normalizeCompactToolLabel(entry.command ?? "");
  return command.length > 0 ? command : undefined;
}

function areToolLifecycleCommandsCompatible(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  if (!previous || !next) {
    return true;
  }
  return previous === next || previous.startsWith(next) || next.startsWith(previous);
}

function areToolLifecycleChangedFilesCompatible(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): boolean {
  if (!previous?.length || !next?.length) {
    return true;
  }
  const nextSet = new Set(next);
  return previous.some((path) => nextSet.has(path));
}
