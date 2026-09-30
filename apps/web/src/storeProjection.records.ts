import type { MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationSpaceShell } from "@glade/contracts/orchestration/threadEntities";
import {
  arraysShallowEqual,
  deepEqualJson,
  type ProjectNormalizationInput,
} from "./storeNormalization.shared";
import { normalizeProject, normalizeSpace } from "./storeNormalization.messages";
import { resolveThreadSidebarMetadata } from "./storeNormalization.threads";
import { projectCwdKey } from "./storePersistence";
import type { AppState } from "./storeState";
import type {
  ChatMessage,
  Space,
  SidebarThreadSummary,
  Thread,
  ThreadShell,
  ThreadTurnState,
} from "./types";

export type ReadModelThread = OrchestrationReadModel["threads"][number];

export type ProjectMatchPolicy = "id-only" | "id-or-cwd";

export function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt ?? null,
    settledAt: thread.settledAt ?? null,
    updatedAt: thread.updatedAt,
    isPinned: thread.isPinned ?? false,
    envMode: thread.envMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    workingDirectory: thread.workingDirectory ?? null,
    associatedWorktreePath: thread.associatedWorktreePath ?? null,
    associatedWorktreeBranch: thread.associatedWorktreeBranch ?? null,
    associatedWorktreeRef: thread.associatedWorktreeRef ?? null,
    createBranchFlowCompleted: thread.createBranchFlowCompleted ?? false,
    parentThreadId: thread.parentThreadId ?? null,
    creationSource: thread.creationSource ?? null,
    sourceThreadId: thread.sourceThreadId ?? null,
    subagentAgentId: thread.subagentAgentId ?? null,
    subagentNickname: thread.subagentNickname ?? null,
    subagentRole: thread.subagentRole ?? null,
    forkSourceThreadId: thread.forkSourceThreadId ?? null,
    lastKnownPr: thread.lastKnownPr ?? null,
    handoff: thread.handoff ?? null,
    claudeCacheReview: thread.claudeCacheReview ?? null,
    ...(thread.claudeCacheReviewSequence !== undefined
      ? { claudeCacheReviewSequence: thread.claudeCacheReviewSequence }
      : {}),
    ...(thread.pinnedMessages !== undefined ? { pinnedMessages: thread.pinnedMessages } : {}),
    ...(thread.notes !== undefined ? { notes: thread.notes } : {}),

    ...(thread.latestHumanMessageAt !== undefined
      ? { latestHumanMessageAt: thread.latestHumanMessageAt }
      : {}),
    ...(thread.latestUserMessageAt !== undefined
      ? { latestUserMessageAt: thread.latestUserMessageAt }
      : {}),
    ...(thread.hasPendingApprovals !== undefined
      ? { hasPendingApprovals: thread.hasPendingApprovals }
      : {}),
    ...(thread.hasPendingUserInput !== undefined
      ? { hasPendingUserInput: thread.hasPendingUserInput }
      : {}),
    ...(thread.hasActionableProposedPlan !== undefined
      ? { hasActionableProposedPlan: thread.hasActionableProposedPlan }
      : {}),
    ...(thread.pendingInteractions !== undefined
      ? { pendingInteractions: thread.pendingInteractions }
      : {}),
    ...(thread.lastVisitedAt !== undefined ? { lastVisitedAt: thread.lastVisitedAt } : {}),
  };
}

export function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

interface NormalizedSlice<TId extends string, TValue> {
  readonly ids: TId[];
  readonly byId: Record<TId, TValue>;
}

export function buildNormalizedSlice<TId extends string, TValue>(
  items: readonly TValue[],
  getId: (item: TValue) => TId,
  previousItems: readonly TValue[] | undefined,
  previousIds: TId[] | undefined,
  previousById: Record<TId, TValue> | undefined,
): NormalizedSlice<TId, TValue> {
  let reusableIds: TId[] | undefined;
  if (
    previousItems !== undefined &&
    previousIds !== undefined &&
    previousById !== undefined &&
    previousItems.length === items.length &&
    previousIds.length === items.length
  ) {
    let firstChangedIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      if (previousItems[index] !== items[index]) {
        firstChangedIndex = index;
        break;
      }
    }
    if (firstChangedIndex < 0) {
      return { ids: previousIds, byId: previousById };
    }

    reusableIds = previousIds;
    for (let index = firstChangedIndex; index < items.length; index += 1) {
      if (previousIds[index] !== getId(items[index]!)) {
        reusableIds = undefined;
        break;
      }
    }
  }

  const byId = {} as Record<TId, TValue>;
  if (reusableIds !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      byId[getId(item)] = item;
    }
    return { ids: reusableIds, byId };
  }

  const ids: TId[] = new Array<TId>(items.length);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const id = getId(item);
    ids[index] = id;
    byId[id] = item;
  }
  return { ids, byId };
}

export const messageId = (message: ChatMessage): MessageId => message.id;

export const activityId = (activity: Thread["activities"][number]): string => activity.id;

export const proposedPlanId = (plan: Thread["proposedPlans"][number]): string => plan.id;

export const turnDiffId = (summary: Thread["turnDiffSummaries"][number]): TurnId => summary.turnId;

export function upsertProject(
  state: AppState,
  incoming: ProjectNormalizationInput,
  matchPolicy: ProjectMatchPolicy,
): AppState {
  if (state.deletedProjectIdsById?.[incoming.id] !== undefined) {
    return state;
  }
  const existingProject =
    state.projects.find((project) => project.id === incoming.id) ??
    (matchPolicy === "id-or-cwd"
      ? state.projects.find(
          (project) => projectCwdKey(project.cwd) === projectCwdKey(incoming.workspaceRoot),
        )
      : undefined);
  const nextProject = normalizeProject(incoming, existingProject);

  if (existingProject) {
    if (existingProject === nextProject) {
      return state;
    }
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === existingProject.id ? nextProject : project,
      ),
    };
  }

  return {
    ...state,
    projects: [...state.projects, nextProject],
  };
}

export function upsertSpace(
  state: AppState,
  incoming: OrchestrationReadModel["spaces"][number] | OrchestrationSpaceShell,
): AppState {
  const existing = state.spaces.find((space) => space.id === incoming.id);
  const nextSpace = normalizeSpace(incoming, existing);
  if (existing === nextSpace) return state;
  const spaces = existing
    ? state.spaces.map((space) => (space.id === incoming.id ? nextSpace : space))
    : [...state.spaces, nextSpace];
  return {
    ...state,
    spaces: spaces.toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    ),
  };
}

export function removeSpace(
  state: AppState,
  spaceId: Space["id"],
  assignmentUpdatedAt?: string,
): AppState {
  const spaces = state.spaces.filter((space) => space.id !== spaceId);
  let projectsChanged = false;
  const projects = state.projects.map((project) => {
    if ((project.spaceId ?? null) !== spaceId) return project;
    projectsChanged = true;
    return {
      ...project,
      spaceId: null,
      ...(assignmentUpdatedAt !== undefined
        ? {
            updatedAt:
              project.updatedAt && project.updatedAt > assignmentUpdatedAt
                ? project.updatedAt
                : assignmentUpdatedAt,
          }
        : {}),
    };
  });
  if (spaces.length === state.spaces.length && !projectsChanged) return state;
  return { ...state, spaces, projects: projectsChanged ? projects : state.projects };
}

export function applySpaceOrder(
  state: AppState,
  orderedSpaceIds: ReadonlyArray<Space["id"]>,
  updatedAt?: string,
): AppState {
  const orderById = new Map(orderedSpaceIds.map((spaceId, index) => [spaceId, index] as const));
  const spaces = state.spaces
    .map((space) => {
      const sortOrder = orderById.get(space.id);
      return sortOrder === undefined || sortOrder === space.sortOrder
        ? space
        : { ...space, sortOrder, ...(updatedAt !== undefined ? { updatedAt } : {}) };
    })
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return arraysShallowEqual(spaces, state.spaces) ? state : { ...state, spaces };
}

function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.interactionMode === right.interactionMode &&
    left.envMode === right.envMode &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    (left.workingDirectory ?? null) === (right.workingDirectory ?? null) &&
    (left.associatedWorktreePath ?? null) === (right.associatedWorktreePath ?? null) &&
    (left.associatedWorktreeBranch ?? null) === (right.associatedWorktreeBranch ?? null) &&
    (left.associatedWorktreeRef ?? null) === (right.associatedWorktreeRef ?? null) &&
    left.session === right.session &&
    left.createdAt === right.createdAt &&
    (left.archivedAt ?? null) === (right.archivedAt ?? null) &&
    (left.settledAt ?? null) === (right.settledAt ?? null) &&
    left.updatedAt === right.updatedAt &&
    (left.isPinned ?? false) === (right.isPinned ?? false) &&
    left.latestTurn === right.latestTurn &&
    left.lastVisitedAt === right.lastVisitedAt &&
    (left.parentThreadId ?? null) === (right.parentThreadId ?? null) &&
    (left.creationSource ?? null) === (right.creationSource ?? null) &&
    (left.subagentAgentId ?? null) === (right.subagentAgentId ?? null) &&
    (left.subagentNickname ?? null) === (right.subagentNickname ?? null) &&
    (left.subagentRole ?? null) === (right.subagentRole ?? null) &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.latestHumanMessageAt === right.latestHumanMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan &&
    left.hasLiveTailWork === right.hasLiveTailWork &&
    (left.forkSourceThreadId ?? null) === (right.forkSourceThreadId ?? null) &&
    deepEqualJson(left.lastKnownPr ?? null, right.lastKnownPr ?? null) &&
    (left.handoff ?? null) === (right.handoff ?? null)
  );
}

export function buildSidebarThreadSummary(
  thread: Thread,
  previous?: SidebarThreadSummary,
): SidebarThreadSummary {
  const metadata = resolveThreadSidebarMetadata(thread);
  const nextSummary: SidebarThreadSummary = {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    interactionMode: thread.interactionMode,
    envMode: thread.envMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    workingDirectory: thread.workingDirectory ?? null,
    associatedWorktreePath: thread.associatedWorktreePath ?? null,
    associatedWorktreeBranch: thread.associatedWorktreeBranch ?? null,
    associatedWorktreeRef: thread.associatedWorktreeRef ?? null,
    session: thread.session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt ?? null,
    settledAt: thread.settledAt ?? null,
    updatedAt: thread.updatedAt,
    isPinned: thread.isPinned ?? false,
    latestTurn: thread.latestTurn,
    lastVisitedAt: thread.lastVisitedAt,
    parentThreadId: thread.parentThreadId ?? null,
    creationSource: thread.creationSource ?? null,
    subagentAgentId: thread.subagentAgentId ?? null,
    subagentNickname: thread.subagentNickname ?? null,
    subagentRole: thread.subagentRole ?? null,
    latestUserMessageAt: metadata.latestUserMessageAt,
    latestHumanMessageAt: metadata.latestHumanMessageAt ?? null,
    hasPendingApprovals: metadata.hasPendingApprovals,
    hasPendingUserInput: metadata.hasPendingUserInput,
    hasActionableProposedPlan: metadata.hasActionableProposedPlan,
    hasLiveTailWork: metadata.hasLiveTailWork,
    forkSourceThreadId: thread.forkSourceThreadId ?? null,
    lastKnownPr: thread.lastKnownPr ?? null,
    handoff: thread.handoff ?? null,
  };
  if (previous && sidebarThreadSummariesEqual(previous, nextSummary)) {
    return previous;
  }
  return nextSummary;
}

export // Every consumer memoizing on `state.threadIds` therefore recomputed on each snapshot, and the
// "nothing changed" fast path in `syncServerReadModel` could never fire, because its identity check
// on this exact field always failed. Seeding the finished order up front makes the loop's
// `ensureThreadRegistered` calls no-ops, so the reference survives whenever the set and the order
// of threads survive.
function reuseThreadIdRegistry(
  previous: ThreadId[] | undefined,
  nextThreadIds: ReadonlySet<ThreadId>,
): ThreadId[] {
  if (previous && previous.length === nextThreadIds.size) {
    let index = 0;
    let identical = true;
    for (const threadId of nextThreadIds) {
      if (previous[index] !== threadId) {
        identical = false;
        break;
      }
      index += 1;
    }
    if (identical) {
      return previous;
    }
  }
  return [...nextThreadIds];
}
