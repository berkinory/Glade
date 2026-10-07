import {
  VisualReply,
  VISUAL_REPLY_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/visualReply";
import { Schema, Option } from "effect";
import { CommandId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import { HandoffTransitionStage } from "@glade/contracts/orchestration/threadEntities";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type {
  OrchestrationLatestTurnState,
  OrchestrationThreadActivity,
} from "@glade/contracts/orchestration/threadEntities";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { summarizeToolRawOutput } from "./features/chat/timeline/toolOutputSummary";
import { pluralize, stripTerminalControlSequences } from "@glade/shared/text/text";
import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { deriveReadableToolTitle } from "./lib/toolCallLabel.commands";
import {
  deriveGladeMcpToolTitle,
  isGenericToolTitle,
  type GladeMcpToolStatus,
} from "./lib/toolCallLabel.descriptors";
import {
  extractGladeMcpToolName,
  normalizeGladeMcpIdentifier,
  normalizeToolTextForComparison,
} from "./lib/toolCallLabel.presentations";
import { browserToolResultPreview } from "./lib/browserToolPresentation";
import { deriveWorkLogToolDetails } from "./lib/toolCallDetails";
import { compareActivitiesByOrder } from "./workLog.ordering";
import {
  CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND,
  PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND,
  SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS,
} from "./workLog.types";
import type {
  DerivedWorkLogEntry,
  ProviderContextLifecycleInfo,
  ProviderContextLifecycleReason,
  WorkLogEntry,
  WorkLogGladeCreatedThread,
  WorkLogGladeThreadCreation,
  WorkLogLiveActivity,
  WorkLogLiveActivityState,
} from "./workLog.types";
import {
  collapseDerivedWorkLogEntries,
  deriveToolLifecycleCollapseCommand,
  deriveToolLifecycleCollapseKey,
  isRenderableToolLifecycleActivity,
  reconcileSettledLiveActivities,
} from "./workLog.reconciliation";
import { classifyWorkLogToolKind } from "./workLog.toolKind";
import {
  collabPayloadItem,
  deriveCommandActionDisplay,
  extractChangedFiles,
  extractCollabAction,
  extractCollabSubagents,
  extractPrimaryCommandAction,
  extractToolCallId,
  extractToolCommand,
  extractToolName,
  extractMcpService,
  extractToolTitle,
  extractWorkLogItemType,
  extractWorkLogRequestKind,
  firstFiniteNumber,
  stripTrailingExitCode,
} from "./workLog.extraction";

const orderedActivitiesCache = new WeakMap<
  ReadonlyArray<OrchestrationThreadActivity>,
  ReadonlyArray<OrchestrationThreadActivity>
>();

function isActivityOrderStable(activities: ReadonlyArray<OrchestrationThreadActivity>): boolean {
  for (let index = 1; index < activities.length; index += 1) {
    if (compareActivitiesByOrder(activities[index - 1]!, activities[index]!) > 0) {
      return false;
    }
  }
  return true;
}

export function orderedActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const cached = orderedActivitiesCache.get(activities);
  if (cached) {
    return cached;
  }

  const ordered = isActivityOrderStable(activities)
    ? activities
    : activities.toSorted(compareActivitiesByOrder);
  orderedActivitiesCache.set(activities, ordered);
  return ordered;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  options: {
    visibleTurnIds?: ReadonlySet<TurnId | string>;
    activeTurnId?: TurnId | null;
    activeTurnStartedAt?: string | null;
    latestTurnState?: OrchestrationLatestTurnState | null;
    latestTurnCompletedAt?: string | null;
  } = {},
): WorkLogEntry[] {
  const visibleTurnIds = options.visibleTurnIds;
  const ordered = orderedActivities(activities);
  const entries = ordered
    .filter(
      (activity) =>
        shouldKeepActivityForWorkLog(activity, latestTurnId, visibleTurnIds) &&
        activity.kind !== "task.started" &&
        activity.kind !== "task.updated" &&
        activity.kind !== "task.completed" &&
        !isQuietTurnLifecycleActivity(activity) &&
        !isRoutineApprovalAcceptance(activity) &&
        activity.kind !== "account.rate-limits.updated" &&
        activity.kind !== "context-window.updated" &&
        activity.kind !== "context-window.configured" &&
        activity.summary !== "Checkpoint captured",
    )
    .map(toDerivedWorkLogEntry);

  return reconcileSettledLiveActivities(
    collapseDerivedWorkLogEntries(entries),
    ordered,
    latestTurnId,
    options,
  )
    .filter((entry) => !isUninformativeCommandStartEntry(entry))
    .map(
      ({
        collapseCommand: _collapseCommand,
        collapseKey: _collapseKey,
        runtimeWarningMessage: _runtimeWarningMessage,
        runtimeWarningRepeatCount: _runtimeWarningRepeatCount,
        suppressStandaloneCommandStart: _suppressStandaloneCommandStart,
        taskListHasTasks: _taskListHasTasks,
        ...entry
      }) => entry,
    );
}

function shouldKeepActivityForWorkLog(
  activity: OrchestrationThreadActivity,
  latestTurnId: TurnId | undefined,
  visibleTurnIds: ReadonlySet<TurnId | string> | undefined,
): boolean {
  if (activity.kind === "subagent.prompt") return false;
  if (activity.kind === PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND) {
    return true;
  }

  if (
    activity.kind === "auth.status" ||
    activity.kind === "provider.transition" ||
    (activity.kind === "context-compaction" && activity.turnId === null)
  ) {
    return true;
  }

  if (activity.kind === CHECKPOINT_REVERT_FAILED_ACTIVITY_KIND) {
    return true;
  }

  if (visibleTurnIds && visibleTurnIds.size > 0) {
    return activity.turnId !== null && visibleTurnIds.has(activity.turnId);
  }

  return latestTurnId ? activity.turnId === latestTurnId : true;
}

function isQuietTurnLifecycleActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "turn.completed" && activity.kind !== "turn.aborted") {
    return false;
  }

  return activity.tone !== "error";
}

// Presentation only: the activity stays durable and pending approvals are derived
// from raw activities. Refusals, cancellations, errors, session or permission
// grants stay visible.
function isRoutineApprovalAcceptance(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "approval.resolved" || activity.tone === "error") {
    return false;
  }
  const payload = asObjectRecord(activity.payload);
  return (
    payload?.decision === "accept" &&
    payload.approvalScope === undefined &&
    payload.requestKind !== "permissions"
  );
}

function isUninformativeCommandStartEntry(entry: DerivedWorkLogEntry): boolean {
  return entry.activityKind === "tool.started" && entry.suppressStandaloneCommandStart === true;
}

function extractWorkLogGladeThreadCreation(
  payload: Record<string, unknown> | null,
): WorkLogGladeThreadCreation | null {
  if (!payload) {
    return null;
  }
  const operationId = nonEmptyTrimmed(payload.operationId) ?? null;
  const rawThreads = Array.isArray(payload.threads) ? payload.threads : [];
  if (!operationId || rawThreads.length === 0) {
    return null;
  }
  const threads = rawThreads.flatMap((value): WorkLogGladeCreatedThread[] => {
    const thread = asObjectRecord(value);
    const threadId = nonEmptyTrimmed(thread?.threadId) ?? null;
    const title = nonEmptyTrimmed(thread?.title) ?? null;
    const provider = nonEmptyTrimmed(thread?.provider) ?? null;
    const model = nonEmptyTrimmed(thread?.model) ?? null;
    const environment = nonEmptyTrimmed(thread?.environment) ?? null;
    const status = nonEmptyTrimmed(thread?.status) ?? "created";
    const providerKind = PROVIDER_DESCRIPTORS.find(
      (descriptor) => descriptor.kind === provider,
    )?.kind;
    if (
      !threadId ||
      !title ||
      !providerKind ||
      !model ||
      (environment !== "local" && environment !== "worktree")
    ) {
      return [];
    }
    return [{ threadId, title, provider: providerKind, model, environment, status }];
  });
  if (threads.length === 0) {
    return null;
  }
  const requestedCount =
    typeof payload.requestedCount === "number" && Number.isInteger(payload.requestedCount)
      ? payload.requestedCount
      : threads.length;
  const createdCount =
    typeof payload.createdCount === "number" && Number.isInteger(payload.createdCount)
      ? payload.createdCount
      : threads.length;
  return { operationId, requestedCount, createdCount, threads };
}

export interface TaskListTaskSnapshot {
  task: string;
  status: "pending" | "inProgress" | "completed";
}

export function parseTaskListTasks(payload: unknown): TaskListTaskSnapshot[] | null {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const rawTasks = record?.tasks;
  if (!Array.isArray(rawTasks)) {
    return null;
  }
  const tasks = rawTasks
    .map((entry): TaskListTaskSnapshot | null => {
      if (!entry || typeof entry !== "object") return null;
      const taskRecord = entry as Record<string, unknown>;
      if (typeof taskRecord.task !== "string") {
        return null;
      }
      const status =
        taskRecord.status === "completed" || taskRecord.status === "inProgress"
          ? taskRecord.status
          : "pending";
      return { task: taskRecord.task, status };
    })
    .filter((task): task is TaskListTaskSnapshot => task !== null);
  if (rawTasks.length > 0 && tasks.length === 0) {
    return null;
  }
  return tasks;
}

function isProviderContextLifecycleReason(value: unknown): value is ProviderContextLifecycleReason {
  return (
    value === "conversation-rebuilt" ||
    value === "fresh-session" ||
    value === "interrupt-escalation" ||
    value === "native-history-unavailable" ||
    value === "native-resume-failed"
  );
}

function extractProviderContextLifecycleInfo(
  payload: Record<string, unknown> | null,
): ProviderContextLifecycleInfo | null {
  const provider = PROVIDER_DESCRIPTORS.find(
    (descriptor) => descriptor.kind === payload?.provider,
  )?.kind;
  const nativeHistory = payload?.nativeHistory;
  const restartReason = payload?.restartReason;
  const sessionRestarted = payload?.sessionRestarted;
  const recapInjected = payload?.recapInjected;
  const recapCharacters = payload?.recapCharacters;
  const recapPreview = payload?.recapPreview;
  const recapPreviewTruncated = payload?.recapPreviewTruncated;
  if (
    !provider ||
    (nativeHistory !== "available" && nativeHistory !== "unavailable") ||
    !isProviderContextLifecycleReason(restartReason) ||
    typeof sessionRestarted !== "boolean" ||
    typeof recapInjected !== "boolean" ||
    typeof recapCharacters !== "number" ||
    !Number.isInteger(recapCharacters) ||
    recapCharacters < 0 ||
    (recapPreview !== null && typeof recapPreview !== "string") ||
    typeof recapPreviewTruncated !== "boolean"
  ) {
    return null;
  }
  const boundedPreview =
    typeof recapPreview === "string" &&
    recapPreview.length > SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS
      ? `…${recapPreview.slice(-(SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS - 1)).trimStart()}`
      : recapPreview;
  return {
    provider,
    nativeHistory,
    restartReason,
    sessionRestarted,
    recapInjected,
    recapCharacters,
    recapPreview: boundedPreview,
    recapPreviewTruncated:
      recapPreviewTruncated ||
      (typeof recapPreview === "string" && recapPreview.length > (boundedPreview?.length ?? 0)),
  };
}

const transitionSummary = Schema.Struct({
  operationId: CommandId,
  stage: HandoffTransitionStage,
  source: Schema.Struct({ provider: ProviderKind }),
  destination: Schema.Struct({ provider: ProviderKind }),
});
const decodeTransitionSummary = Schema.decodeUnknownOption(transitionSummary);
const decodeStoredTransitionSummary = Schema.decodeUnknownOption(
  Schema.fromJsonString(transitionSummary),
);

const activityEntryCache = new WeakMap<OrchestrationThreadActivity, DerivedWorkLogEntry>();

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const cached = activityEntryCache.get(activity);
  if (cached) return cached;
  const entry = normalizeWorkLogActivity(activity);
  activityEntryCache.set(activity, entry);
  return entry;
}

function normalizeWorkLogActivity(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandAction = extractPrimaryCommandAction(payload);
  const commandPreview = extractToolCommand(payload, commandAction);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const toolName = extractToolName(payload);
  const mcpService = extractMcpService(payload);
  const toolCallId = extractToolCallId(payload);
  const toolStatus = deriveToolLifecycleStatus(activity.kind, payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    ...(activity.sequence !== undefined ? { sequence: activity.sequence } : {}),
    ...(activity.turnId !== null ? { turnId: activity.turnId } : {}),
    label: activity.summary,
    tone: activity.tone === "approval" ? "info" : activity.tone,
    activityKind: activity.kind,
    ...(toolName ? { toolName } : {}),
    ...(mcpService ? { mcpService } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolStatus ? { toolStatus } : {}),
  };
  if (activity.kind === "response.started") {
    const source = asObjectRecord(payload?.replySource);
    const threadId = nonEmptyTrimmed(source?.threadId);
    const nickname = nonEmptyTrimmed(source?.nickname);
    if (threadId && nickname) entry.replySource = { threadId, nickname };
    else entry.label = "Subagent reply";
  }
  if (activity.kind === VISUAL_REPLY_ACTIVITY_KIND) {
    const reply = Schema.decodeUnknownOption(VisualReply)(activity.payload);
    if (Option.isSome(reply)) entry.visualReply = reply.value;
  }
  if (activity.kind === "provider.transition") {
    const transition = Option.getOrUndefined(
      Option.orElse(decodeTransitionSummary(payload), () =>
        decodeStoredTransitionSummary(payload?.detail),
      ),
    );
    if (transition) entry.providerTransition = transition;
  }
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (payload && typeof payload.detail === "string" && payload.detail.length > 0) {
    const detail = stripTrailingExitCode(stripTerminalControlSequences(payload.detail)).output;
    if (detail) {
      entry.detail = detail;
    }
  }
  const outputDetail =
    activity.kind === "provider.event.unmapped" ? null : summarizeToolPayloadOutput(payload);
  if (outputDetail && (!entry.detail || toolStatus === "failed")) {
    entry.detail = stripTerminalControlSequences(outputDetail);
  }
  const collabTaskOutputDetail = extractCollabTaskOutputDetail(payload);
  if (collabTaskOutputDetail) {
    entry.detail = stripTerminalControlSequences(collabTaskOutputDetail);
  }
  const nativeEventType =
    payload && typeof payload.nativeEventType === "string" && payload.nativeEventType.length > 0
      ? payload.nativeEventType
      : undefined;
  if (nativeEventType) {
    entry.nativeEventType = nativeEventType;
  }
  const runtimeWarningMessage =
    activity.kind === "runtime.warning" &&
    typeof payload?.message === "string" &&
    payload.message.trim().length > 0
      ? stripTerminalControlSequences(payload.message).trim()
      : undefined;
  if (runtimeWarningMessage) {
    entry.detail ??= runtimeWarningMessage;
    entry.preview = runtimeWarningMessage;
    entry.runtimeWarningMessage = entry.detail ?? runtimeWarningMessage;
  }
  if (activity.kind === "turn.tasks.updated") {
    const tasks = parseTaskListTasks(payload);
    if (tasks && tasks.length > 0) {
      entry.taskListHasTasks = true;
      const completedCount = tasks.filter((task) => task.status === "completed").length;
      entry.label = `${completedCount} out of ${tasks.length} ${pluralize(tasks.length, "task")} completed`;
      const inProgressTask = tasks.find((task) => task.status === "inProgress");
      if (inProgressTask) {
        entry.detail = inProgressTask.task;
      } else {
        delete entry.detail;
      }
    }

    if (activity.turnId !== null) {
      entry.collapseKey = `taskList:${activity.turnId}`;
    }
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  const commandActionDisplay = deriveCommandActionDisplay(commandAction, activity.kind);
  if (commandActionDisplay?.preview) {
    entry.preview = commandActionDisplay.preview;
  }
  const gladeToolName = toolName
    ? extractGladeMcpToolName(normalizeGladeMcpIdentifier(toolName))
    : null;
  const browserOutput = outputDetail ?? entry.detail;
  if (gladeToolName && browserOutput && toolStatus !== "failed") {
    const browserPreview = browserToolResultPreview(gladeToolName, browserOutput);
    if (browserPreview) entry.preview = browserPreview;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  const toolKind = classifyWorkLogToolKind({
    itemType,
    requestKind,
    toolName,
    command: commandPreview.command ?? commandPreview.rawCommand,
    commandActionType: commandAction?.type,
  });
  if (toolKind) {
    entry.toolKind = toolKind;
  }
  if (
    activity.kind === "tool.started" &&
    itemType === "command_execution" &&
    !commandAction &&
    !commandPreview.command &&
    !toolName
  ) {
    entry.suppressStandaloneCommandStart = true;
  }
  const subagents = extractCollabSubagents(payload);
  if (subagents.length > 0) {
    entry.subagents = subagents;
  }
  const subagentAction = extractCollabAction(payload, subagents);
  if (subagentAction) {
    entry.subagentAction = subagentAction;
  }
  if (activity.kind === "glade.threads.created") {
    const gladeThreadCreation = extractWorkLogGladeThreadCreation(payload);
    if (gladeThreadCreation) {
      entry.gladeThreadCreation = gladeThreadCreation;
    }
  }
  if (activity.kind === PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND) {
    const providerContextLifecycle = extractProviderContextLifecycleInfo(payload);
    if (providerContextLifecycle) {
      entry.providerContextLifecycle = providerContextLifecycle;
    }
  }
  const readableTitle =
    extractCollabActionTitle(payload) ??
    deriveGladeMcpToolTitle({
      toolName,
      title: commandActionDisplay?.title ?? title,
      fallbackLabel: activity.summary,
      status: toolStatus,
    }) ??
    deriveReadableToolTitle({
      title: commandActionDisplay?.title ?? title,
      fallbackLabel: activity.summary,
      itemType,
      requestKind,
      command: commandPreview.command,
      payload,
      isRunning: activity.kind !== "tool.completed",
    });
  // Task-list rows derive their own progress heading above. The generic activity summary ("Tasks
  // updated") would otherwise become toolTitle and take precedence over that progress label in
  // TimelineWorkEntryRow.
  if (readableTitle && activity.kind !== "turn.tasks.updated") {
    entry.toolTitle = readableTitle;
  }
  const liveActivity = deriveWorkLogLiveActivity(activity, payload, entry);
  if (liveActivity) {
    entry.liveActivity = liveActivity;
  }
  if (
    entry.detail &&
    normalizeToolTextForComparison(entry.detail) ===
      normalizeToolTextForComparison(entry.toolTitle ?? entry.label)
  ) {
    delete entry.detail;
  }
  const toolDetails = deriveWorkLogToolDetails({
    payload,
    itemType,
    requestKind,
    command: entry.command,
    rawCommand: entry.rawCommand,
    detail: entry.detail,
    changedFiles: entry.changedFiles ?? changedFiles,
    label: entry.label,
    toolTitle: entry.toolTitle,
  });
  if (toolDetails) {
    entry.toolDetails = toolDetails;
  }
  const collapseKey =
    deriveProviderRuntimeReconciliationCollapseKey(activity, payload) ??
    deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  const collapseCommand = deriveToolLifecycleCollapseCommand(entry);
  if (collapseCommand) {
    entry.collapseCommand = collapseCommand;
  }
  return entry;
}

function deriveProviderRuntimeReconciliationCollapseKey(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
): string | undefined {
  if (activity.kind !== "provider.runtime.reconciled") {
    return undefined;
  }
  const provider = nonEmptyTrimmed(payload?.provider) ?? null;
  const action = nonEmptyTrimmed(payload?.action) ?? null;
  const projectedTurnId = nonEmptyTrimmed(payload?.projectedTurnId) ?? activity.turnId ?? undefined;
  const runtimeTurnId = nonEmptyTrimmed(payload?.runtimeTurnId) ?? null;
  if (
    !provider ||
    !projectedTurnId ||
    (action !== "settle-interrupted" &&
      action !== "settle-terminal-projection" &&
      action !== "settle-error" &&
      action !== "align-running-turn") ||
    (action === "align-running-turn" && !runtimeTurnId)
  ) {
    return undefined;
  }
  // Session and turn projections converge independently. A single stale turn can therefore be
  // observed first as interrupted, then as terminal or failed. Those settlement actions refine one
  // recovery; a runtime realignment remains distinct because its live turn id identifies separate
  // evidence.
  const operation = action === "align-running-turn" ? action : "settle-running-turn";
  return `provider-runtime-reconcile:${JSON.stringify([
    provider,
    operation,
    projectedTurnId,
    runtimeTurnId ?? null,
  ])}`;
}

function deriveToolLifecycleStatus(
  activityKind: OrchestrationThreadActivity["kind"],
  payload: Record<string, unknown> | null,
): GladeMcpToolStatus | undefined {
  if (!isRenderableToolLifecycleActivity(activityKind)) return undefined;
  if (isFailedToolLifecyclePayload(payload)) return "failed";
  if (isCancelledToolLifecyclePayload(payload)) return "cancelled";
  return activityKind === "tool.completed" ? "completed" : "running";
}

function deriveWorkLogLiveActivity(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): WorkLogLiveActivity | undefined {
  if (!isRenderableToolLifecycleActivity(activity.kind)) {
    return undefined;
  }

  const data = asObjectRecord(payload?.data);
  const stateRecord = asObjectRecord(data?.state);
  const rawOutput = asObjectRecord(data?.rawOutput);
  const rawStatus = [payload?.status, data?.status, stateRecord?.status, rawOutput?.status].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const normalizedStatus = rawStatus?.trim().toLowerCase();
  const state: WorkLogLiveActivityState = isFailedToolLifecyclePayload(payload)
    ? "failed"
    : isCancelledToolLifecyclePayload(payload)
      ? "cancelled"
      : activity.kind === "tool.completed" ||
          (normalizedStatus &&
            ["completed", "complete", "success", "succeeded"].includes(normalizedStatus))
        ? "completed"
        : "running_tool";
  const detail =
    nonEmptyTrimmed(data?.summary) ??
    (activity.kind === "tool.updated"
      ? (nonEmptyTrimmed(payload?.detail) ?? null)
      : state === "failed" || state === "cancelled"
        ? (entry.detail ?? null)
        : null);
  const progress = deriveWorkLogLiveActivityProgress(payload, data);
  const elapsedSeconds = firstFiniteNumber(payload?.elapsedSeconds, data?.elapsedSeconds);

  return {
    state,
    label: entry.toolTitle ?? entry.label,
    lastActivityAt: activity.createdAt,
    ...(activity.kind === "tool.started" ? { startedAt: activity.createdAt } : {}),
    ...(detail ? { detail } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
  };
}

function deriveWorkLogLiveActivityProgress(
  payload: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
): number | undefined {
  const progress = firstFiniteNumber(payload?.progress, data?.progress);
  if (progress !== undefined) {
    return progress;
  }

  const percent = firstFiniteNumber(data?.percent);
  return percent === undefined ? undefined : percent / 100;
}

function isFailedToolLifecyclePayload(payload: Record<string, unknown> | null): boolean {
  const data = asObjectRecord(payload?.data);
  const state = asObjectRecord(data?.state);
  const rawOutput = asObjectRecord(data?.rawOutput);
  const statuses = [payload?.status, data?.status, state?.status, rawOutput?.status];
  if (
    statuses.some(
      (status) =>
        typeof status === "string" && ["error", "failed", "failure"].includes(status.toLowerCase()),
    )
  ) {
    return true;
  }
  return [
    payload?.isError,
    payload?.is_error,
    data?.isError,
    data?.is_error,
    rawOutput?.isError,
    rawOutput?.is_error,
  ].some((flag) => flag === true || flag === 1 || flag === "true");
}

function isCancelledToolLifecyclePayload(payload: Record<string, unknown> | null): boolean {
  const data = asObjectRecord(payload?.data);
  const state = asObjectRecord(data?.state);
  const rawOutput = asObjectRecord(data?.rawOutput);
  return [payload?.status, data?.status, state?.status, rawOutput?.status].some(
    (status) =>
      typeof status === "string" &&
      ["cancelled", "canceled", "declined", "interrupted", "killed", "stopped", "aborted"].includes(
        status.trim().toLowerCase(),
      ),
  );
}

function summarizeToolPayloadOutput(payload: Record<string, unknown> | null): string | null {
  const data = asObjectRecord(payload?.data);
  return summarizeToolRawOutput(data?.rawOutput) ?? null;
}

function extractCollabTaskOutputDetail(payload: Record<string, unknown> | null): string | null {
  if (extractWorkLogItemType(payload) !== "collab_agent_tool_call") {
    return null;
  }
  const data = asObjectRecord(payload?.data);
  const item = collabPayloadItem(payload);
  const state = asObjectRecord(data?.state) ?? asObjectRecord(item?.state);
  const candidates = [
    state?.output,
    data?.output,
    item?.output,
    data?.rawOutput,
    data?.result,
    item?.result,
  ];
  for (const candidate of candidates) {
    const normalized = extractCollabTaskText(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function extractCollabActionTitle(payload: Record<string, unknown> | null): string | null {
  if (extractWorkLogItemType(payload) !== "collab_agent_tool_call") {
    return null;
  }
  const item = collabPayloadItem(payload);
  const input = asObjectRecord(item?.input);
  const state = asObjectRecord(item?.state);
  const candidates = [
    state?.title,
    item?.title,
    payload?.title,
    input?.description,
    item?.description,
  ];
  for (const candidate of candidates) {
    const title = nonEmptyTrimmed(candidate) ?? null;
    if (title && !isGenericToolTitle(title)) {
      return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
    }
  }
  return null;
}

function extractCollabTaskText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractCollabTaskText(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const direct = normalizeCollabTaskOutput(nonEmptyTrimmed(value) ?? null);
  if (direct) {
    return direct;
  }
  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }
  return (
    extractCollabTaskText(record.content) ??
    extractCollabTaskText(record.text) ??
    extractCollabTaskText(record.output) ??
    extractCollabTaskText(record.result)
  );
}

function normalizeCollabTaskOutput(value: string | null): string | null {
  const output = value ? stripTrailingExitCode(value).output : null;
  if (!output) {
    return null;
  }
  const taskResultMatch = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/i.exec(output);
  if (taskResultMatch?.[1]) {
    return taskResultMatch[1].trim() || null;
  }
  const unwrappedTask = output
    .replace(/^<task\b[^>]*>\s*/i, "")
    .replace(/\s*<\/task>\s*$/i, "")
    .trim();
  return (unwrappedTask || output).trim() || null;
}
