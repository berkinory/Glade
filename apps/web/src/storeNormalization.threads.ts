import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationSessionStatus } from "@glade/contracts/orchestration/threadEntities";
import { resolveThreadBranchRegressionGuard } from "@glade/shared/git/git";
import { deriveThreadSummaryMetadata } from "@glade/shared/threads/threadSummary";
import { hasLiveTurnTailWork } from "./session-logic";
import { getRememberedProjectUiState, projectCwdKey } from "./storePersistence";
import type {
  Project,
  SidebarThreadSummary,
  Thread,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
} from "./types";
import {
  arraysShallowEqual,
  deepEqualJson,
  normalizeModelSelection,
  resolveCreateBranchFlowCompletedMerge,
} from "./storeNormalization.shared";
import type {
  ProjectNormalizationInput,
  ReadModelThread,
  ShellSnapshotThread,
} from "./storeNormalization.shared";
import {
  isNonFatalThreadErrorMessage,
  normalizeActivities,
  normalizeProposedPlans,
  normalizeThreadErrorMessage,
  normalizeTurnDiffSummaries,
} from "./storeNormalization.activity";
import { normalizeChatMessages, normalizeProject } from "./storeNormalization.messages";

export function normalizeThreadSession(
  incoming: ReadModelThread["session"],
  previous: Thread["session"] | undefined | null,
): Thread["session"] {
  if (!incoming) {
    return null;
  }
  // Shell snapshots and the live thread stream arrive independently. A delayed pre-turn session must
  // not replace the running session (or revive a finished one), otherwise the composer briefly loses
  // its stop/queue controls.
  if (previous && incoming.updatedAt < previous.updatedAt) {
    return previous;
  }
  const nextLastError =
    incoming.lastError && !isNonFatalThreadErrorMessage(incoming.lastError)
      ? incoming.lastError
      : undefined;
  const nextSession = {
    provider: toLegacyProvider(incoming.providerName),
    status: toLegacySessionStatus(incoming.status),
    orchestrationStatus: incoming.status,
    activeTurnId: incoming.activeTurnId ?? undefined,
    createdAt: incoming.updatedAt,
    updatedAt: incoming.updatedAt,
    ...(nextLastError ? { lastError: nextLastError } : {}),
  } satisfies NonNullable<Thread["session"]>;
  if (
    previous &&
    previous.provider === nextSession.provider &&
    previous.status === nextSession.status &&
    previous.orchestrationStatus === nextSession.orchestrationStatus &&
    previous.activeTurnId === nextSession.activeTurnId &&
    previous.createdAt === nextSession.createdAt &&
    previous.updatedAt === nextSession.updatedAt &&
    previous.lastError === nextSession.lastError
  ) {
    return previous;
  }
  return nextSession;
}

function normalizeLatestTurn(
  incoming: ReadModelThread["latestTurn"],
  previous: Thread["latestTurn"] | undefined | null,
): Thread["latestTurn"] {
  if (!incoming) {
    return null;
  }
  const nextSourceProposedPlan = incoming.sourceProposedPlan
    ? previous?.sourceProposedPlan &&
      previous.sourceProposedPlan.threadId === incoming.sourceProposedPlan.threadId &&
      previous.sourceProposedPlan.planId === incoming.sourceProposedPlan.planId
      ? previous.sourceProposedPlan
      : incoming.sourceProposedPlan
    : undefined;

  if (
    previous &&
    previous.turnId === incoming.turnId &&
    previous.state === incoming.state &&
    previous.requestedAt === incoming.requestedAt &&
    previous.startedAt === incoming.startedAt &&
    previous.completedAt === incoming.completedAt &&
    previous.assistantMessageId === incoming.assistantMessageId &&
    previous.sourceProposedPlan === nextSourceProposedPlan
  ) {
    return previous;
  }

  return {
    turnId: incoming.turnId,
    state: incoming.state,
    requestedAt: incoming.requestedAt,
    startedAt: incoming.startedAt,
    completedAt: incoming.completedAt,
    assistantMessageId: incoming.assistantMessageId,
    ...(nextSourceProposedPlan ? { sourceProposedPlan: nextSourceProposedPlan } : {}),
  };
}

export function normalizeThreadFromReadModel(
  incoming: ReadModelThread,
  previous: Thread | undefined,
  snapshotSequence?: number,
): Thread {
  const modelSelection = normalizeModelSelection(incoming.modelSelection, previous?.modelSelection);
  const session = normalizeThreadSession(incoming.session, previous?.session);
  const messages = normalizeChatMessages(incoming.messages, previous?.messages);
  const proposedPlans = normalizeProposedPlans(incoming.proposedPlans, previous?.proposedPlans);
  const latestTurn = normalizeLatestTurn(incoming.latestTurn, previous?.latestTurn);
  const handoff =
    previous?.handoff && incoming.handoff && deepEqualJson(previous.handoff, incoming.handoff)
      ? previous.handoff
      : (incoming.handoff ?? null);
  const incomingClaudeCacheReview =
    snapshotSequence !== undefined && snapshotSequence < (previous?.claudeCacheReviewSequence ?? 0)
      ? previous?.claudeCacheReview
      : incoming.claudeCacheReview;
  const claudeCacheReviewSequence =
    snapshotSequence === undefined
      ? previous?.claudeCacheReviewSequence
      : Math.max(snapshotSequence, previous?.claudeCacheReviewSequence ?? 0);
  const claudeCacheReview =
    previous?.claudeCacheReview &&
    deepEqualJson(previous.claudeCacheReview, incomingClaudeCacheReview ?? null)
      ? previous.claudeCacheReview
      : (incomingClaudeCacheReview ?? null);
  const lastKnownPr =
    previous?.lastKnownPr &&
    incoming.lastKnownPr &&
    deepEqualJson(previous.lastKnownPr, incoming.lastKnownPr)
      ? previous.lastKnownPr
      : (incoming.lastKnownPr ?? null);
  const pinnedMessages =
    previous?.pinnedMessages &&
    deepEqualJson(previous.pinnedMessages, incoming.pinnedMessages ?? null)
      ? previous.pinnedMessages
      : (incoming.pinnedMessages as Thread["pinnedMessages"]);
  const notes = incoming.notes;
  const goal = incoming.goal;
  const goalStartedAt = incoming.goalStartedAt;
  const goalPausedAt = incoming.goalPausedAt;
  const goalAchievements =
    previous?.goalAchievements &&
    deepEqualJson(previous.goalAchievements, incoming.goalAchievements ?? null)
      ? previous.goalAchievements
      : (incoming.goalAchievements as Thread["goalAchievements"]);
  const turnDiffSummaries = normalizeTurnDiffSummaries(
    incoming.checkpoints,
    previous?.turnDiffSummaries,
  );
  const activities = normalizeActivities(incoming.activities, previous?.activities);
  const incomingPendingInteractions = Object.hasOwn(incoming, "pendingInteractions")
    ? (incoming.pendingInteractions ?? [])
    : previous?.pendingInteractions;
  const pendingInteractions =
    previous?.pendingInteractions &&
    deepEqualJson(previous.pendingInteractions, incomingPendingInteractions ?? [])
      ? previous.pendingInteractions
      : incomingPendingInteractions === undefined
        ? undefined
        : [...incomingPendingInteractions];
  const error = normalizeThreadErrorMessage(session?.lastError);
  const lastVisitedAt = previous?.lastVisitedAt ?? incoming.updatedAt;
  const resolvedLatestHumanMessageAt = incoming.latestHumanMessageAt;
  const resolvedLatestUserMessageAt =
    Object.hasOwn(incoming, "latestUserMessageAt") && incoming.latestUserMessageAt !== undefined
      ? (incoming.latestUserMessageAt ?? null)
      : undefined;
  const resolvedHasPendingApprovals =
    typeof incoming.hasPendingApprovals === "boolean" ? incoming.hasPendingApprovals : undefined;
  const resolvedHasPendingUserInput =
    typeof incoming.hasPendingUserInput === "boolean" ? incoming.hasPendingUserInput : undefined;
  const resolvedHasActionableProposedPlan =
    typeof incoming.hasActionableProposedPlan === "boolean"
      ? incoming.hasActionableProposedPlan
      : undefined;
  const nextWorktreePath = incoming.worktreePath;
  const nextWorkingDirectory = incoming.workingDirectory ?? null;
  const nextAssociatedWorktreePath = incoming.associatedWorktreePath ?? null;
  const nextAssociatedWorktreeBranch = incoming.associatedWorktreeBranch ?? null;
  const nextAssociatedWorktreeRef = incoming.associatedWorktreeRef ?? null;
  const resolvedBranch = resolveThreadBranchRegressionGuard({
    currentBranch: previous?.branch ?? null,
    nextBranch: incoming.branch,
  });
  const resolvedCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
    currentBranch: previous?.branch ?? null,
    nextBranch: resolvedBranch,
    currentWorktreePath: previous?.worktreePath ?? null,
    nextWorktreePath,
    currentAssociatedWorktreePath: previous?.associatedWorktreePath,
    nextAssociatedWorktreePath,
    currentAssociatedWorktreeBranch: previous?.associatedWorktreeBranch,
    nextAssociatedWorktreeBranch,
    currentAssociatedWorktreeRef: previous?.associatedWorktreeRef,
    nextAssociatedWorktreeRef,
    currentCreateBranchFlowCompleted: previous?.createBranchFlowCompleted,
    nextCreateBranchFlowCompleted: incoming.createBranchFlowCompleted,
  });
  const pendingSourceProposedPlan =
    latestTurn?.sourceProposedPlan ??
    (incoming.session?.status === "running" ? previous?.pendingSourceProposedPlan : undefined);

  if (
    previous &&
    previous.projectId === incoming.projectId &&
    previous.title === incoming.title &&
    previous.modelSelection === modelSelection &&
    previous.runtimeMode === incoming.runtimeMode &&
    previous.interactionMode === incoming.interactionMode &&
    previous.session === session &&
    previous.messages === messages &&
    previous.proposedPlans === proposedPlans &&
    previous.error === error &&
    previous.createdAt === incoming.createdAt &&
    (previous.archivedAt ?? null) === (incoming.archivedAt ?? null) &&
    (previous.settledAt ?? null) === (incoming.settledAt ?? null) &&
    previous.updatedAt === incoming.updatedAt &&
    (previous.isPinned ?? false) === (incoming.isPinned ?? false) &&
    previous.latestTurn === latestTurn &&
    previous.pendingSourceProposedPlan === pendingSourceProposedPlan &&
    previous.lastVisitedAt === lastVisitedAt &&
    (previous.parentThreadId ?? null) === (incoming.parentThreadId ?? null) &&
    (previous.creationSource ?? null) === (incoming.creationSource ?? null) &&
    (previous.sourceThreadId ?? null) === (incoming.sourceThreadId ?? null) &&
    (previous.subagentAgentId ?? null) === (incoming.subagentAgentId ?? null) &&
    (previous.subagentNickname ?? null) === (incoming.subagentNickname ?? null) &&
    (previous.subagentRole ?? null) === (incoming.subagentRole ?? null) &&
    previous.envMode === (incoming.envMode ?? "local") &&
    previous.branch === resolvedBranch &&
    previous.worktreePath === nextWorktreePath &&
    (previous.workingDirectory ?? null) === nextWorkingDirectory &&
    (previous.associatedWorktreePath ?? null) === nextAssociatedWorktreePath &&
    (previous.associatedWorktreeBranch ?? null) === nextAssociatedWorktreeBranch &&
    (previous.associatedWorktreeRef ?? null) === nextAssociatedWorktreeRef &&
    (previous.createBranchFlowCompleted ?? false) === resolvedCreateBranchFlowCompleted &&
    previous.latestUserMessageAt === resolvedLatestUserMessageAt &&
    previous.latestHumanMessageAt === resolvedLatestHumanMessageAt &&
    previous.hasPendingApprovals === resolvedHasPendingApprovals &&
    previous.hasPendingUserInput === resolvedHasPendingUserInput &&
    previous.hasActionableProposedPlan === resolvedHasActionableProposedPlan &&
    (previous.forkSourceThreadId ?? null) === (incoming.forkSourceThreadId ?? null) &&
    deepEqualJson(previous.lastKnownPr ?? null, lastKnownPr) &&
    (previous.handoff ?? null) === handoff &&
    (previous.claudeCacheReview ?? null) === claudeCacheReview &&
    previous.claudeCacheReviewSequence === claudeCacheReviewSequence &&
    previous.pinnedMessages === pinnedMessages &&
    previous.notes === notes &&
    previous.goal === goal &&
    (previous.goalStartedAt ?? null) === (goalStartedAt ?? null) &&
    (previous.goalPausedAt ?? null) === (goalPausedAt ?? null) &&
    previous.goalAchievements === goalAchievements &&
    previous.turnDiffSummaries === turnDiffSummaries &&
    previous.activities === activities &&
    previous.pendingInteractions === pendingInteractions
  ) {
    return previous;
  }

  return {
    id: incoming.id,
    codexThreadId: null,
    projectId: incoming.projectId,
    title: incoming.title,
    modelSelection,
    runtimeMode: incoming.runtimeMode,
    interactionMode: incoming.interactionMode,
    session,
    messages,
    proposedPlans,
    error,
    createdAt: incoming.createdAt,
    archivedAt: incoming.archivedAt ?? null,
    settledAt: incoming.settledAt ?? null,
    updatedAt: incoming.updatedAt,
    isPinned: incoming.isPinned ?? false,
    latestTurn,
    ...(pendingSourceProposedPlan ? { pendingSourceProposedPlan } : {}),
    lastVisitedAt,
    parentThreadId: incoming.parentThreadId ?? null,
    creationSource: incoming.creationSource ?? null,
    sourceThreadId: incoming.sourceThreadId ?? null,
    subagentAgentId: incoming.subagentAgentId ?? null,
    subagentNickname: incoming.subagentNickname ?? null,
    subagentRole: incoming.subagentRole ?? null,
    envMode: incoming.envMode ?? "local",
    branch: resolvedBranch,
    worktreePath: nextWorktreePath,
    workingDirectory: nextWorkingDirectory,
    associatedWorktreePath: nextAssociatedWorktreePath,
    associatedWorktreeBranch: nextAssociatedWorktreeBranch,
    associatedWorktreeRef: nextAssociatedWorktreeRef,
    createBranchFlowCompleted: resolvedCreateBranchFlowCompleted,
    forkSourceThreadId: incoming.forkSourceThreadId ?? null,
    lastKnownPr,
    handoff,
    claudeCacheReview,
    ...(claudeCacheReviewSequence !== undefined ? { claudeCacheReviewSequence } : {}),
    ...(pinnedMessages !== undefined ? { pinnedMessages } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(goalStartedAt !== undefined ? { goalStartedAt } : {}),
    ...(goalPausedAt !== undefined ? { goalPausedAt } : {}),
    ...(goalAchievements !== undefined ? { goalAchievements } : {}),
    ...(resolvedLatestHumanMessageAt !== undefined
      ? { latestHumanMessageAt: resolvedLatestHumanMessageAt }
      : {}),
    ...(resolvedLatestUserMessageAt !== undefined
      ? { latestUserMessageAt: resolvedLatestUserMessageAt }
      : {}),
    ...(resolvedHasPendingApprovals !== undefined
      ? { hasPendingApprovals: resolvedHasPendingApprovals }
      : {}),
    ...(resolvedHasPendingUserInput !== undefined
      ? { hasPendingUserInput: resolvedHasPendingUserInput }
      : {}),
    ...(resolvedHasActionableProposedPlan !== undefined
      ? { hasActionableProposedPlan: resolvedHasActionableProposedPlan }
      : {}),
    turnDiffSummaries,
    activities,
    ...(pendingInteractions !== undefined ? { pendingInteractions } : {}),
  };
}

export function normalizeThreadShellSnapshot(
  incoming: ShellSnapshotThread,
  previous: Thread | undefined,
  snapshotSequence?: number,
): {
  shell: ThreadShell;
  session: ThreadSession | null;
  turnState: ThreadTurnState;
} {
  const modelSelection = normalizeModelSelection(incoming.modelSelection, previous?.modelSelection);
  const session = normalizeThreadSession(incoming.session, previous?.session);
  const latestTurn = normalizeLatestTurn(incoming.latestTurn, previous?.latestTurn);
  const handoff =
    previous?.handoff && incoming.handoff && deepEqualJson(previous.handoff, incoming.handoff)
      ? previous.handoff
      : (incoming.handoff ?? null);
  const incomingClaudeCacheReview =
    snapshotSequence !== undefined && snapshotSequence < (previous?.claudeCacheReviewSequence ?? 0)
      ? previous?.claudeCacheReview
      : incoming.claudeCacheReview;
  const claudeCacheReviewSequence =
    snapshotSequence === undefined
      ? previous?.claudeCacheReviewSequence
      : Math.max(snapshotSequence, previous?.claudeCacheReviewSequence ?? 0);
  const claudeCacheReview =
    previous?.claudeCacheReview &&
    deepEqualJson(previous.claudeCacheReview, incomingClaudeCacheReview ?? null)
      ? previous.claudeCacheReview
      : (incomingClaudeCacheReview ?? null);
  const lastKnownPr =
    previous?.lastKnownPr &&
    incoming.lastKnownPr &&
    deepEqualJson(previous.lastKnownPr, incoming.lastKnownPr)
      ? previous.lastKnownPr
      : (incoming.lastKnownPr ?? null);
  const error = normalizeThreadErrorMessage(session?.lastError);
  const lastVisitedAt = previous?.lastVisitedAt ?? incoming.updatedAt;
  const nextWorktreePath = incoming.worktreePath;
  const nextWorkingDirectory = incoming.workingDirectory ?? null;
  const nextAssociatedWorktreePath = incoming.associatedWorktreePath ?? null;
  const nextAssociatedWorktreeBranch = incoming.associatedWorktreeBranch ?? null;
  const nextAssociatedWorktreeRef = incoming.associatedWorktreeRef ?? null;
  const goal = incoming.goal !== undefined ? incoming.goal : previous?.goal;
  const goalStartedAt =
    incoming.goalStartedAt !== undefined ? incoming.goalStartedAt : previous?.goalStartedAt;
  const goalPausedAt =
    incoming.goalPausedAt !== undefined ? incoming.goalPausedAt : previous?.goalPausedAt;
  const resolvedBranch = resolveThreadBranchRegressionGuard({
    currentBranch: previous?.branch ?? null,
    nextBranch: incoming.branch,
  });
  const resolvedCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
    currentBranch: previous?.branch ?? null,
    nextBranch: resolvedBranch,
    currentWorktreePath: previous?.worktreePath ?? null,
    nextWorktreePath,
    currentAssociatedWorktreePath: previous?.associatedWorktreePath,
    nextAssociatedWorktreePath,
    currentAssociatedWorktreeBranch: previous?.associatedWorktreeBranch,
    nextAssociatedWorktreeBranch,
    currentAssociatedWorktreeRef: previous?.associatedWorktreeRef,
    nextAssociatedWorktreeRef,
    currentCreateBranchFlowCompleted: previous?.createBranchFlowCompleted,
    nextCreateBranchFlowCompleted: incoming.createBranchFlowCompleted,
  });
  const shell: ThreadShell = {
    id: incoming.id,
    codexThreadId: previous?.codexThreadId ?? null,
    projectId: incoming.projectId,
    title: incoming.title,
    modelSelection,
    runtimeMode: incoming.runtimeMode,
    interactionMode: incoming.interactionMode,
    error,
    createdAt: incoming.createdAt,
    archivedAt: incoming.archivedAt ?? null,
    settledAt: incoming.settledAt ?? null,
    updatedAt: incoming.updatedAt,
    isPinned: incoming.isPinned ?? false,
    envMode: incoming.envMode ?? "local",
    branch: resolvedBranch,
    worktreePath: nextWorktreePath,
    workingDirectory: nextWorkingDirectory,
    associatedWorktreePath: nextAssociatedWorktreePath,
    associatedWorktreeBranch: nextAssociatedWorktreeBranch,
    associatedWorktreeRef: nextAssociatedWorktreeRef,
    createBranchFlowCompleted: resolvedCreateBranchFlowCompleted,
    parentThreadId: incoming.parentThreadId ?? null,
    creationSource: incoming.creationSource ?? null,
    sourceThreadId: incoming.sourceThreadId ?? null,
    subagentAgentId: incoming.subagentAgentId ?? null,
    subagentNickname: incoming.subagentNickname ?? null,
    subagentRole: incoming.subagentRole ?? null,
    forkSourceThreadId: incoming.forkSourceThreadId ?? null,
    lastKnownPr,
    handoff,
    claudeCacheReview,
    ...(claudeCacheReviewSequence !== undefined ? { claudeCacheReviewSequence } : {}),

    ...(previous?.pinnedMessages !== undefined ? { pinnedMessages: previous.pinnedMessages } : {}),
    ...(previous?.notes !== undefined ? { notes: previous.notes } : {}),
    ...(previous?.goalAchievements !== undefined
      ? { goalAchievements: previous.goalAchievements }
      : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(goalStartedAt !== undefined ? { goalStartedAt } : {}),
    ...(goalPausedAt !== undefined ? { goalPausedAt } : {}),
    ...(incoming.latestHumanMessageAt !== undefined
      ? { latestHumanMessageAt: incoming.latestHumanMessageAt }
      : {}),
    ...(incoming.latestUserMessageAt !== undefined
      ? { latestUserMessageAt: incoming.latestUserMessageAt ?? null }
      : {}),
    ...(incoming.hasPendingApprovals !== undefined
      ? { hasPendingApprovals: incoming.hasPendingApprovals }
      : {}),
    ...(incoming.hasPendingUserInput !== undefined
      ? { hasPendingUserInput: incoming.hasPendingUserInput }
      : {}),
    ...(incoming.hasActionableProposedPlan !== undefined
      ? { hasActionableProposedPlan: incoming.hasActionableProposedPlan }
      : {}),
    ...(previous?.pendingInteractions !== undefined
      ? { pendingInteractions: previous.pendingInteractions }
      : {}),
    ...(lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
  };
  return {
    shell,
    session,
    turnState: {
      latestTurn,
      ...(latestTurn?.sourceProposedPlan
        ? { pendingSourceProposedPlan: latestTurn.sourceProposedPlan }
        : {}),
    },
  };
}

export function mapProjects(
  incoming: ReadonlyArray<ProjectNormalizationInput>,
  previous: Project[],
): Project[] {
  const rememberedUiState = getRememberedProjectUiState();
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(
    previous.map((project) => [projectCwdKey(project.cwd), project] as const),
  );
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [projectCwdKey(project.cwd), index] as const),
  );
  const usePersistedOrder = previous.length === 0;

  const mappedProjects = incoming
    .map((project) => {
      const previousWithSameId = previousById.get(project.id);
      const existing =
        previousWithSameId ?? previousByCwd.get(projectCwdKey(project.workspaceRoot));
      return normalizeProject(project, existing);
    })
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(projectCwdKey(project.cwd));
      const persistedIndex = usePersistedOrder
        ? rememberedUiState.projectOrderIndexForCwd(projectCwdKey(project.cwd))
        : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? rememberedUiState.projectOrderCount : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((a, b) => {
      const byOrder = a.orderIndex - b.orderIndex;
      if (byOrder !== 0) return byOrder;
      return a.incomingIndex - b.incomingIndex;
    })
    .map((entry) => entry.project);

  return arraysShallowEqual(previous, mappedProjects) ? previous : mappedProjects;
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  return providerName === "claudeAgent" ? "claudeAgent" : "codex";
}

export function resolveThreadSidebarMetadata(
  thread: Thread,
): Pick<
  SidebarThreadSummary,
  | "latestUserMessageAt"
  | "latestHumanMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "hasLiveTailWork"
> {
  const needsDerivedMetadata =
    thread.latestUserMessageAt === undefined ||
    thread.latestHumanMessageAt === undefined ||
    thread.hasPendingApprovals === undefined ||
    thread.hasPendingUserInput === undefined ||
    thread.hasActionableProposedPlan === undefined;
  const derivedMetadata = needsDerivedMetadata
    ? deriveThreadSummaryMetadata({
        messages: thread.messages,
        activities: thread.activities,
        proposedPlans: thread.proposedPlans,
        latestTurn: thread.latestTurn,
      })
    : null;

  return {
    latestUserMessageAt: thread.latestUserMessageAt ?? derivedMetadata?.latestUserMessageAt ?? null,
    latestHumanMessageAt:
      thread.latestHumanMessageAt !== undefined
        ? thread.latestHumanMessageAt
        : (derivedMetadata?.latestHumanMessageAt ?? null),
    hasPendingApprovals:
      thread.hasPendingApprovals ?? derivedMetadata?.hasPendingApprovals ?? false,
    hasPendingUserInput:
      thread.hasPendingUserInput ?? derivedMetadata?.hasPendingUserInput ?? false,
    hasActionableProposedPlan:
      thread.hasActionableProposedPlan ?? derivedMetadata?.hasActionableProposedPlan ?? false,
    hasLiveTailWork: Boolean(
      hasLiveTurnTailWork({
        latestTurn: thread.latestTurn,
        messages: thread.messages,
        activities: thread.activities,
        session: thread.session,
      }),
    ),
  };
}
