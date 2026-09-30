import {
  type OrchestrationProposedPlan,
  type OrchestrationThreadActivity,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type OrchestrationProject,
  OrchestrationSpaceShell,
  type OrchestrationMessage,
  OrchestrationProjectShell,
  type OrchestrationThreadShell,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import {
  type ProjectionThreadMessageDbRow,
  orchestrationMessageFromProjectionRow,
} from "../../persistence/projectionThreadMessageRow.ts";
import {
  ProjectionThreadMessageSegmentDbRow,
  type ProjectionThreadMessageTextSegment,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import { joinMessageTextChunks } from "../../persistence/messageTextChunks.ts";
import { deriveThreadSummaryMetadata } from "@glade/shared/threads/threadSummary";
import {
  ProjectionThreadProposedPlanDbRow,
  ProjectionThreadActivityDbRow,
  ProjectionCheckpointDbRow,
  ProjectionLatestTurnDbRow,
  ProjectionThreadSessionDbRow,
  ProjectionProjectDbRow,
  ProjectionSpaceDbRow,
  ProjectionStateDbRow,
  PendingInteractionRow,
  ProjectionThreadShellDbRow,
  ProjectionThreadDbRow,
} from "./snapshotSchemas";

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

export function maxOptionalIso(
  left: string | null,
  right: string | null | undefined,
): string | null {
  return right ? maxIso(left, right) : left;
}

function pushGrouped<T>(map: Map<string, T[]>, threadId: string, value: T): void {
  const existing = map.get(threadId);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(threadId, [value]);
}

export function toProjectedProposedPlan(
  row: ProjectionThreadProposedPlanDbRow,
): OrchestrationProposedPlan {
  return {
    id: row.planId,
    turnId: row.turnId,
    planMarkdown: row.planMarkdown,
    implementedAt: row.implementedAt,
    implementationThreadId: row.implementationThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedActivity(
  row: ProjectionThreadActivityDbRow,
): OrchestrationThreadActivity {
  return {
    id: row.activityId,
    tone: row.tone,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload as OrchestrationThreadActivity["payload"],
    turnId: row.turnId,
    ...(row.sequence !== null ? { sequence: row.sequence } : {}),
    createdAt: row.createdAt,
  };
}

export function toProjectedCheckpoint(
  row: ProjectionCheckpointDbRow,
): OrchestrationCheckpointSummary {
  return {
    turnId: row.turnId,
    checkpointTurnCount: row.checkpointTurnCount,
    checkpointRef: row.checkpointRef,
    status: row.status,
    files: row.files,
    assistantMessageId: row.assistantMessageId,
    completedAt: row.completedAt,
  };
}

export function toProjectedLatestTurn(row: ProjectionLatestTurnDbRow): OrchestrationLatestTurn {
  return {
    turnId: row.turnId,
    state:
      row.state === "error"
        ? "error"
        : row.state === "interrupted"
          ? "interrupted"
          : row.state === "completed"
            ? "completed"
            : "running",
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: row.sourceProposedPlanThreadId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

export function toProjectedSession(row: ProjectionThreadSessionDbRow): OrchestrationSession {
  return {
    threadId: row.threadId,
    status: row.status,
    providerName: row.providerName,
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedProject(row: ProjectionProjectDbRow): OrchestrationProject {
  return {
    id: row.projectId,
    kind: row.kind,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    isPinned: row.isPinned > 0,
    spaceId: row.spaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function toProjectedSpace(row: ProjectionSpaceDbRow) {
  return {
    id: row.spaceId,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  } as const;
}

export function toProjectedSpaceShell(row: ProjectionSpaceDbRow): OrchestrationSpaceShell {
  return {
    id: row.spaceId,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function collectBaseUpdatedAt(input: {
  readonly spaceRows: ReadonlyArray<ProjectionSpaceDbRow>;
  readonly projectRows: ReadonlyArray<ProjectionProjectDbRow>;
  readonly threadRows: ReadonlyArray<{ readonly updatedAt: string }>;
  readonly stateRows: ReadonlyArray<ProjectionStateDbRow>;
}): string | null {
  let updatedAt: string | null = null;
  for (const row of input.spaceRows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
  }
  for (const row of input.projectRows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
  }
  for (const row of input.threadRows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
  }
  for (const row of input.stateRows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
  }
  return updatedAt;
}

export function collectProjectedMessages(rows: ReadonlyArray<ProjectionThreadMessageDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationMessage>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationMessage>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    pushGrouped(byThread, row.threadId, orchestrationMessageFromProjectionRow(row));
  }
  return { byThread, updatedAt };
}

export function attachThreadMessageSegments(
  rows: ReadonlyArray<ProjectionThreadMessageDbRow>,
  segmentRows: ReadonlyArray<ProjectionThreadMessageSegmentDbRow>,
): ReadonlyArray<ProjectionThreadMessageDbRow> {
  if (segmentRows.length === 0) {
    return rows;
  }
  const segmentsByMessage = new Map<string, ProjectionThreadMessageTextSegment[]>();
  for (const segment of segmentRows) {
    const key = JSON.stringify([segment.threadId, segment.messageId]);
    const entry = {
      sequence: segment.sequence,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      text: joinMessageTextChunks(segment),
    };
    const existing = segmentsByMessage.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      segmentsByMessage.set(key, [entry]);
    }
  }
  return rows.map((row) => {
    const rowSegments = segmentsByMessage.get(JSON.stringify([row.threadId, row.messageId]));
    return rowSegments ? { ...row, textSegments: rowSegments } : row;
  });
}

export function collectProjectedProposedPlans(
  rows: ReadonlyArray<ProjectionThreadProposedPlanDbRow>,
): {
  readonly byThread: Map<string, Array<OrchestrationProposedPlan>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationProposedPlan>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    pushGrouped(byThread, row.threadId, toProjectedProposedPlan(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedActivities(rows: ReadonlyArray<ProjectionThreadActivityDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationThreadActivity>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationThreadActivity>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.createdAt);
    pushGrouped(byThread, row.threadId, toProjectedActivity(row));
  }
  return { byThread, updatedAt };
}

export function collectPendingInteractions(rows: ReadonlyArray<PendingInteractionRow>): {
  readonly byThread: Map<string, Array<PendingInteractionRow>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<PendingInteractionRow>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.createdAt);
    updatedAt = maxOptionalIso(updatedAt, row.responseRequestedAt);
    updatedAt = maxOptionalIso(updatedAt, row.resolvedAt);
    pushGrouped(byThread, row.threadId, row);
  }
  return { byThread, updatedAt };
}

export function collectProjectedCheckpoints(rows: ReadonlyArray<ProjectionCheckpointDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationCheckpointSummary>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.completedAt);
    pushGrouped(byThread, row.threadId, toProjectedCheckpoint(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedLatestTurns(rows: ReadonlyArray<ProjectionLatestTurnDbRow>): {
  readonly byThread: Map<string, OrchestrationLatestTurn>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, OrchestrationLatestTurn>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxOptionalIso(updatedAt, row.historyUpdatedAt);
    updatedAt = maxIso(updatedAt, row.requestedAt);
    updatedAt = maxOptionalIso(updatedAt, row.startedAt);
    updatedAt = maxOptionalIso(updatedAt, row.completedAt);
    if (byThread.has(row.threadId)) {
      continue;
    }
    byThread.set(row.threadId, toProjectedLatestTurn(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedSessions(rows: ReadonlyArray<ProjectionThreadSessionDbRow>): {
  readonly byThread: Map<string, OrchestrationSession>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, OrchestrationSession>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    byThread.set(row.threadId, toProjectedSession(row));
  }
  return { byThread, updatedAt };
}

export function toProjectedProjectShell(row: ProjectionProjectDbRow): OrchestrationProjectShell {
  return {
    id: row.projectId,
    kind: row.kind,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    isPinned: row.isPinned > 0,
    spaceId: row.spaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedThreadShellFromStoredSummary(input: {
  readonly threadRow: ProjectionThreadShellDbRow;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly session: OrchestrationSession | null;
}): OrchestrationThreadShell {
  const { threadRow } = input;
  return {
    id: threadRow.threadId,
    projectId: threadRow.projectId,
    title: threadRow.title,
    modelSelection: threadRow.modelSelection,
    runtimeMode: threadRow.runtimeMode,
    interactionMode: threadRow.interactionMode,
    envMode: threadRow.envMode,
    branch: threadRow.branch,
    worktreePath: threadRow.worktreePath,
    workingDirectory: threadRow.workingDirectory,
    associatedWorktreePath: threadRow.associatedWorktreePath,
    associatedWorktreeBranch: threadRow.associatedWorktreeBranch,
    associatedWorktreeRef: threadRow.associatedWorktreeRef,
    createBranchFlowCompleted: threadRow.createBranchFlowCompleted > 0,
    isPinned: threadRow.isPinned > 0,
    parentThreadId: threadRow.parentThreadId ?? null,
    creationSource: threadRow.creationSource ?? null,
    sourceThreadId: threadRow.sourceThreadId ?? null,
    sourceTurnId: threadRow.sourceTurnId ?? null,
    gatewayOperationId: threadRow.gatewayOperationId ?? null,
    gatewayOperationIndex: threadRow.gatewayOperationIndex ?? null,
    subagentAgentId: threadRow.subagentAgentId ?? null,
    subagentNickname: threadRow.subagentNickname ?? null,
    subagentRole: threadRow.subagentRole ?? null,
    forkSourceThreadId: threadRow.forkSourceThreadId ?? null,
    lastKnownPr: threadRow.lastKnownPr,
    latestTurn: input.latestTurn,
    latestUserMessageAt: threadRow.latestUserMessageAt,
    latestHumanMessageAt: threadRow.latestHumanMessageAt ?? null,
    hasPendingApprovals: threadRow.pendingApprovalCount > 0,
    hasPendingUserInput: threadRow.pendingUserInputCount > 0,
    hasActionableProposedPlan: threadRow.hasActionableProposedPlan > 0,
    createdAt: threadRow.createdAt,
    updatedAt: threadRow.updatedAt,
    archivedAt: threadRow.archivedAt ?? null,
    settledAt: threadRow.settledAt ?? null,
    handoff: threadRow.handoff,
    ...(threadRow.claudeCacheReview != null
      ? { claudeCacheReview: threadRow.claudeCacheReview }
      : {}),

    session: input.session,
  };
}

export function toProjectedThread(input: {
  readonly threadRow: ProjectionThreadDbRow;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly pendingInteractions: ReadonlyArray<PendingInteractionRow>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly session: OrchestrationSession | null;
}): OrchestrationThread {
  const { threadRow } = input;
  const summary = deriveThreadSummaryMetadata(input);
  return {
    id: threadRow.threadId,
    projectId: threadRow.projectId,
    title: threadRow.title,
    modelSelection: threadRow.modelSelection,
    runtimeMode: threadRow.runtimeMode,
    interactionMode: threadRow.interactionMode,
    envMode: threadRow.envMode,
    branch: threadRow.branch,
    worktreePath: threadRow.worktreePath,
    workingDirectory: threadRow.workingDirectory,
    associatedWorktreePath: threadRow.associatedWorktreePath,
    associatedWorktreeBranch: threadRow.associatedWorktreeBranch,
    associatedWorktreeRef: threadRow.associatedWorktreeRef,
    createBranchFlowCompleted: threadRow.createBranchFlowCompleted > 0,
    isPinned: threadRow.isPinned > 0,
    parentThreadId: threadRow.parentThreadId ?? null,
    creationSource: threadRow.creationSource ?? null,
    sourceThreadId: threadRow.sourceThreadId ?? null,
    sourceTurnId: threadRow.sourceTurnId ?? null,
    gatewayOperationId: threadRow.gatewayOperationId ?? null,
    gatewayOperationIndex: threadRow.gatewayOperationIndex ?? null,
    subagentAgentId: threadRow.subagentAgentId ?? null,
    subagentNickname: threadRow.subagentNickname ?? null,
    subagentRole: threadRow.subagentRole ?? null,
    forkSourceThreadId: threadRow.forkSourceThreadId,
    lastKnownPr: threadRow.lastKnownPr,
    latestTurn: input.latestTurn,
    createdAt: threadRow.createdAt,
    updatedAt: threadRow.updatedAt,
    archivedAt: threadRow.archivedAt ?? null,
    settledAt: threadRow.settledAt ?? null,
    deletedAt: threadRow.deletedAt,
    handoff: threadRow.handoff,
    ...(threadRow.claudeCacheReview != null
      ? { claudeCacheReview: threadRow.claudeCacheReview }
      : {}),
    latestUserMessageAt: summary.latestUserMessageAt,

    latestHumanMessageAt: threadRow.latestHumanMessageAt ?? null,
    hasPendingApprovals: summary.hasPendingApprovals,
    hasPendingUserInput: summary.hasPendingUserInput,
    hasActionableProposedPlan: summary.hasActionableProposedPlan,
    messages: input.messages,
    proposedPlans: input.proposedPlans,
    activities: input.activities,
    pendingInteractions: input.pendingInteractions,
    checkpoints: input.checkpoints,
    ...(threadRow.pinnedMessages !== null ? { pinnedMessages: threadRow.pinnedMessages } : {}),
    ...(threadRow.notes !== null ? { notes: threadRow.notes } : {}),

    session: input.session,
  };
}
