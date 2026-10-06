import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { resolveThreadBranchRegressionGuard } from "@glade/shared/git/git";
import {
  clearRemovedAsyncUserInputResponses,
  mergeAsyncUserInput,
} from "@glade/shared/threads/asyncUserInput";
import {
  addPinnedMessage,
  removePinnedMessage,
  setPinnedMessageDone,
  setPinnedMessageLabel,
} from "@glade/shared/threads/pinnedMessages";
import { deriveThreadSummaryMetadata } from "@glade/shared/threads/threadSummary";
import {
  MAX_THREAD_MESSAGES,
  deepEqualJson,
  normalizeModelSelection,
  resolveCreateBranchFlowCompletedMerge,
} from "./storeNormalization.shared";
import {
  normalizeActivities,
  normalizeThreadErrorMessage,
  withOrchestrationEventSequence,
} from "./storeNormalization.activity";
import { normalizeThreadSession } from "./storeNormalization.threads";
import {
  applySpaceOrder,
  removeSpace,
  upsertProject,
  upsertSpace,
} from "./storeProjection.records";
import {
  applyThreadUpdate,
  removeDeletedProjectFromClientState,
  removeDeletedThreadFromClientState,
} from "./storeProjection.mutations";
import type { AppState } from "./storeState";
import type { Thread } from "./types";
import {
  applyThreadMessageSentEvent,
  applyTurnDiffSummaryToThread,
  buildLatestTurn,
  checkpointStatusToLatestTurnState,
  markInteractionResponding,
  reconcileLatestTurnFromSession,
  reconcilePendingInteractionsFromActivity,
  resolveEventUpdatedAt,
  retainThreadActivitiesAfterRevert,
  retainThreadMessagesAfterRevert,
  rollbackThreadMessagesFromMessage,
  threadActivityUpdatesSummary,
  threadMessageUpdatesSidebarSummary,
  threadMessageUpdatesSummary,
} from "./storeEventReducer.eventHelpers";
import type { ApplyOrchestrationEventOptions } from "./storeEventReducer.eventHelpers";
export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState {
  switch (event.type) {
    case "space.created":
      return upsertSpace(state, {
        id: event.payload.spaceId,
        name: event.payload.name,
        icon: event.payload.icon,
        sortOrder: event.payload.sortOrder,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      });

    case "space.meta-updated": {
      const existing = state.spaces.find((space) => space.id === event.payload.spaceId);
      return existing
        ? upsertSpace(state, {
            ...existing,
            name: event.payload.name ?? existing.name,
            icon: event.payload.icon ?? existing.icon,
            updatedAt: event.payload.updatedAt,
          })
        : state;
    }

    case "space.order-updated":
      return applySpaceOrder(state, event.payload.orderedSpaceIds, event.payload.updatedAt);

    case "space.deleted":
      return removeSpace(state, event.payload.spaceId, event.payload.deletedAt);

    case "project.created":
      return upsertProject(
        state,
        {
          id: event.payload.projectId,
          kind: event.payload.kind,
          title: event.payload.title,
          workspaceRoot: event.payload.workspaceRoot,
          defaultModelSelection: event.payload.defaultModelSelection,
          isPinned: event.payload.isPinned ?? false,
          spaceId: event.payload.spaceId ?? null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        },
        "id-only",
      );

    case "project.meta-updated": {
      const existingProject = state.projects.find(
        (project) => project.id === event.payload.projectId,
      );
      if (!existingProject) {
        return state;
      }
      return upsertProject(
        state,
        {
          id: existingProject.id,
          kind: event.payload.kind ?? existingProject.kind,
          title: event.payload.title ?? existingProject.remoteName,
          workspaceRoot: event.payload.workspaceRoot ?? existingProject.cwd,
          defaultModelSelection:
            event.payload.defaultModelSelection !== undefined
              ? event.payload.defaultModelSelection
              : existingProject.defaultModelSelection,
          isPinned: event.payload.isPinned ?? existingProject.isPinned ?? false,
          spaceId:
            event.payload.spaceId !== undefined
              ? event.payload.spaceId
              : (existingProject.spaceId ?? null),
          createdAt: existingProject.createdAt ?? event.payload.updatedAt,
          updatedAt: event.payload.updatedAt,
        },
        "id-only",
      );
    }

    case "project.deleted": {
      return removeDeletedProjectFromClientState(state, event.payload.projectId, event.sequence);
    }

    case "thread.deleted":
      return removeDeletedThreadFromClientState(state, event.payload.threadId, event.sequence);

    case "thread.meta-updated":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const modelSelection =
            event.payload.modelSelection !== undefined
              ? normalizeModelSelection(event.payload.modelSelection, thread.modelSelection)
              : thread.modelSelection;
          const nextBranch =
            event.payload.branch !== undefined
              ? resolveThreadBranchRegressionGuard({
                  currentBranch: thread.branch,
                  nextBranch: event.payload.branch,
                })
              : thread.branch;
          const nextWorktreePath =
            event.payload.worktreePath !== undefined
              ? event.payload.worktreePath
              : thread.worktreePath;
          const nextWorkingDirectory =
            event.payload.workingDirectory !== undefined
              ? event.payload.workingDirectory
              : (thread.workingDirectory ?? null);
          const nextAssociatedWorktreePath =
            event.payload.associatedWorktreePath !== undefined
              ? event.payload.associatedWorktreePath
              : (thread.associatedWorktreePath ?? null);
          const nextAssociatedWorktreeBranch =
            event.payload.associatedWorktreeBranch !== undefined
              ? event.payload.associatedWorktreeBranch
              : (thread.associatedWorktreeBranch ?? null);
          const nextAssociatedWorktreeRef =
            event.payload.associatedWorktreeRef !== undefined
              ? event.payload.associatedWorktreeRef
              : (thread.associatedWorktreeRef ?? null);
          const nextCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
            currentBranch: thread.branch,
            nextBranch,
            currentWorktreePath: thread.worktreePath,
            nextWorktreePath,
            currentAssociatedWorktreePath: thread.associatedWorktreePath,
            nextAssociatedWorktreePath,
            currentAssociatedWorktreeBranch: thread.associatedWorktreeBranch,
            nextAssociatedWorktreeBranch,
            currentAssociatedWorktreeRef: thread.associatedWorktreeRef,
            nextAssociatedWorktreeRef,
            currentCreateBranchFlowCompleted: thread.createBranchFlowCompleted,
            nextCreateBranchFlowCompleted: event.payload.createBranchFlowCompleted,
          });
          const nextUpdatedAt =
            (thread.updatedAt ?? thread.createdAt) > event.payload.updatedAt
              ? thread.updatedAt
              : event.payload.updatedAt;
          const cwdChanged =
            thread.worktreePath !== nextWorktreePath ||
            (thread.workingDirectory ?? null) !== nextWorkingDirectory;

          if (
            (event.payload.title === undefined || event.payload.title === thread.title) &&
            modelSelection === thread.modelSelection &&
            (event.payload.envMode === undefined || event.payload.envMode === thread.envMode) &&
            nextBranch === thread.branch &&
            nextWorktreePath === thread.worktreePath &&
            nextWorkingDirectory === (thread.workingDirectory ?? null) &&
            nextAssociatedWorktreePath === (thread.associatedWorktreePath ?? null) &&
            nextAssociatedWorktreeBranch === (thread.associatedWorktreeBranch ?? null) &&
            nextAssociatedWorktreeRef === (thread.associatedWorktreeRef ?? null) &&
            nextCreateBranchFlowCompleted === (thread.createBranchFlowCompleted ?? false) &&
            (event.payload.isPinned === undefined ||
              event.payload.isPinned === (thread.isPinned ?? false)) &&
            (event.payload.settledAt === undefined ||
              (event.payload.settledAt ?? null) === (thread.settledAt ?? null)) &&
            (event.payload.parentThreadId === undefined ||
              (event.payload.parentThreadId ?? null) === (thread.parentThreadId ?? null)) &&
            (event.payload.subagentAgentId === undefined ||
              (event.payload.subagentAgentId ?? null) === (thread.subagentAgentId ?? null)) &&
            (event.payload.subagentNickname === undefined ||
              (event.payload.subagentNickname ?? null) === (thread.subagentNickname ?? null)) &&
            (event.payload.subagentRole === undefined ||
              (event.payload.subagentRole ?? null) === (thread.subagentRole ?? null)) &&
            (event.payload.lastKnownPr === undefined ||
              deepEqualJson(event.payload.lastKnownPr ?? null, thread.lastKnownPr ?? null)) &&
            (event.payload.handoff === undefined ||
              (event.payload.handoff ?? null) === (thread.handoff ?? null)) &&
            (event.payload.pinnedMessages === undefined ||
              deepEqualJson(event.payload.pinnedMessages, thread.pinnedMessages ?? null)) &&
            (event.payload.notes === undefined || event.payload.notes === (thread.notes ?? "")) &&
            nextUpdatedAt === thread.updatedAt
          ) {
            return thread;
          }

          return {
            ...thread,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            modelSelection,
            ...(event.payload.envMode !== undefined ? { envMode: event.payload.envMode } : {}),
            branch: nextBranch,
            worktreePath: nextWorktreePath,
            workingDirectory: nextWorkingDirectory,
            associatedWorktreePath: nextAssociatedWorktreePath,
            associatedWorktreeBranch: nextAssociatedWorktreeBranch,
            associatedWorktreeRef: nextAssociatedWorktreeRef,
            createBranchFlowCompleted: nextCreateBranchFlowCompleted,
            ...(event.payload.isPinned !== undefined ? { isPinned: event.payload.isPinned } : {}),
            ...(event.payload.settledAt !== undefined
              ? { settledAt: event.payload.settledAt }
              : {}),
            ...(event.payload.parentThreadId !== undefined
              ? { parentThreadId: event.payload.parentThreadId }
              : {}),
            ...(event.payload.subagentAgentId !== undefined
              ? { subagentAgentId: event.payload.subagentAgentId }
              : {}),
            ...(event.payload.subagentNickname !== undefined
              ? { subagentNickname: event.payload.subagentNickname }
              : {}),
            ...(event.payload.subagentRole !== undefined
              ? { subagentRole: event.payload.subagentRole }
              : {}),
            ...(event.payload.lastKnownPr !== undefined
              ? { lastKnownPr: event.payload.lastKnownPr }
              : {}),
            ...(event.payload.handoff !== undefined ? { handoff: event.payload.handoff } : {}),
            ...(event.payload.pinnedMessages !== undefined
              ? {
                  pinnedMessages: event.payload.pinnedMessages as NonNullable<
                    Thread["pinnedMessages"]
                  >,
                }
              : {}),

            ...(event.payload.notes !== undefined ? { notes: event.payload.notes } : {}),

            updatedAt: nextUpdatedAt,
            ...(cwdChanged ? { session: null } : {}),
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.pinned-message-added":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = addPinnedMessage(thread.pinnedMessages, event.payload.pin);
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-removed":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = removePinnedMessage(
            thread.pinnedMessages,
            event.payload.messageId,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-done-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = setPinnedMessageDone(
            thread.pinnedMessages,
            event.payload.messageId,
            event.payload.done,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.pinned-message-label-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pinnedMessages = setPinnedMessageLabel(
            thread.pinnedMessages,
            event.payload.messageId,
            event.payload.label,
          );
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          if (thread.pinnedMessages === pinnedMessages && thread.updatedAt === updatedAt) {
            return thread;
          }
          return {
            ...thread,
            pinnedMessages,
            updatedAt,
          };
        },
        { ...options, updateSidebarSummary: false },
      );

    case "thread.async-user-input-answered":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => ({
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === event.payload.messageId && message.asyncUserInput
              ? {
                  ...message,
                  asyncUserInput: mergeAsyncUserInput(message.asyncUserInput, {
                    ...message.asyncUserInput,
                    response: event.payload.response,
                    responseSequence: event.sequence,
                  }),
                }
              : message,
          ),
        }),
        { ...options, updateSidebarSummary: false },
      );

    case "thread.message-sent":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => applyThreadMessageSentEvent(thread, event),
        {
          ...options,
          recomputeSummarySignals: threadMessageUpdatesSummary(event),
          updateSidebarSummary:
            options?.updateSidebarSummary === true || threadMessageUpdatesSidebarSummary(event),
        },
      );

    case "thread.claude-cache-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          if (
            event.sequence <=
            Math.max(thread.claudeCacheReviewSequence ?? 0, state.shellSnapshotSequence ?? 0)
          ) {
            return thread;
          }
          const updatedAt = resolveEventUpdatedAt(thread, event.payload.updatedAt);
          return {
            ...thread,
            claudeCacheReview: deepEqualJson(thread.claudeCacheReview ?? null, event.payload.review)
              ? (thread.claudeCacheReview ?? null)
              : event.payload.review,
            claudeCacheReviewSequence: event.sequence,
            updatedAt,
          };
        },
        options,
      );

    case "thread.session-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const session = normalizeThreadSession(event.payload.session, thread.session);
          if (session && event.payload.session.updatedAt < session.updatedAt) {
            return thread;
          }
          const error = normalizeThreadErrorMessage(event.payload.session.lastError);
          const latestTurn = reconcileLatestTurnFromSession(thread, event.payload.session, error);
          if (
            session === thread.session &&
            error === thread.error &&
            latestTurn === thread.latestTurn
          ) {
            return thread;
          }
          return {
            ...thread,
            session,
            error,
            latestTurn,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.turn-interrupt-requested": {
      return state;
    }

    case "thread.session-stop-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          if (thread.session === null) {
            return thread;
          }
          const latestTurn =
            thread.latestTurn !== null &&
            thread.latestTurn.state === "running" &&
            thread.latestTurn.completedAt === null
              ? buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: thread.latestTurn.turnId,
                  state: "interrupted",
                  requestedAt: thread.latestTurn.requestedAt,
                  startedAt: thread.latestTurn.startedAt ?? event.payload.createdAt,
                  completedAt: event.payload.createdAt,
                  assistantMessageId: thread.latestTurn.assistantMessageId,
                })
              : thread.latestTurn;
          return {
            ...thread,
            session: {
              ...thread.session,
              status: "closed",
              orchestrationStatus: "stopped",
              activeTurnId: undefined,
              updatedAt: event.payload.createdAt,
            },
            latestTurn,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.turn-start-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const modelSelection =
            event.payload.modelSelection !== undefined
              ? normalizeModelSelection(event.payload.modelSelection, thread.modelSelection)
              : thread.modelSelection;
          // Historical scheduled turns preserve the user's composer modes, matching server replay.
          const adoptTurnModes = event.payload.dispatchOrigin !== "automation";
          const runtimeMode = adoptTurnModes ? event.payload.runtimeMode : thread.runtimeMode;
          // Mirrors the server projection: a requested turn is in flight until it runs or fails.
          const session =
            thread.session?.status === "connecting" ||
            thread.session?.status === "running" ||
            (thread.session != null && thread.session.updatedAt > event.payload.createdAt)
              ? thread.session
              : {
                  provider: thread.session?.provider ?? modelSelection.provider,
                  status: "connecting" as const,
                  orchestrationStatus: "starting" as const,
                  activeTurnId: undefined,
                  createdAt: event.payload.createdAt,
                  updatedAt: event.payload.createdAt,
                };

          return {
            ...thread,
            modelSelection,
            runtimeMode,
            session,

            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.createdAt
                ? thread.updatedAt
                : event.payload.createdAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.user-input-response-requested":
    case "thread.approval-response-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const pendingInteractions = markInteractionResponding(thread, event);
          return {
            ...thread,
            ...(pendingInteractions !== undefined ? { pendingInteractions } : {}),
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.createdAt
                ? thread.updatedAt
                : event.payload.createdAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.activity-appended":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const sequencedActivity = withOrchestrationEventSequence(
            event.payload.activity,
            event.sequence,
          );
          const nextActivities = normalizeActivities(
            [...thread.activities, sequencedActivity],
            thread.activities,
          );
          const pendingInteractions = reconcilePendingInteractionsFromActivity(
            thread.id,
            thread.pendingInteractions,
            event,
          );
          if (
            nextActivities === thread.activities &&
            pendingInteractions === thread.pendingInteractions
          ) {
            return thread;
          }
          return {
            ...thread,
            activities: nextActivities,
            ...(pendingInteractions !== undefined ? { pendingInteractions } : {}),
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > sequencedActivity.createdAt
                ? thread.updatedAt
                : sequencedActivity.createdAt,
          };
        },
        {
          ...options,
          recomputeSummarySignals: threadActivityUpdatesSummary(event),
          updateSidebarSummary:
            options?.updateSidebarSummary === true || threadActivityUpdatesSummary(event),
        },
      );

    case "thread.turn-diff-completed":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) =>
          applyTurnDiffSummaryToThread(thread, {
            turnId: event.payload.turnId,
            completedAt: event.payload.completedAt,
            status: event.payload.status,
            files: event.payload.files.map((file) => ({
              path: file.path,
              ...(file.kind !== undefined ? { kind: file.kind } : {}),
              ...(file.additions !== undefined ? { additions: file.additions } : {}),
              ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
            })),
            checkpointRef: event.payload.checkpointRef,
            assistantMessageId: event.payload.assistantMessageId ?? undefined,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.reverted":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const turnDiffSummaries = thread.turnDiffSummaries
            .filter(
              (entry) =>
                entry.checkpointTurnCount !== undefined &&
                entry.checkpointTurnCount <= event.payload.turnCount,
            )
            .toSorted(
              (left, right) =>
                (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
                (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
            );
          const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
          const retainedMessages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            event.payload.turnCount,
          );
          const messages = clearRemovedAsyncUserInputResponses(
            retainedMessages,
            new Set(retainedMessages.map((message) => message.id)),
            event.sequence,
          ).slice(-MAX_THREAD_MESSAGES);

          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
          const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

          return {
            ...thread,
            turnDiffSummaries,
            messages,

            activities,

            latestHumanMessageAt: deriveThreadSummaryMetadata({ ...thread, messages })
              .latestHumanMessageAt,
            latestTurn:
              latestCheckpoint === null
                ? null
                : {
                    turnId: latestCheckpoint.turnId,
                    state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                    requestedAt: latestCheckpoint.completedAt,
                    startedAt: latestCheckpoint.completedAt,
                    completedAt: latestCheckpoint.completedAt,
                    assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                  },
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.conversation-rolled-back":
      if (event.payload.numTurns === 0 && event.payload.replacementText === undefined) {
        return state;
      }
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const rollback = rollbackThreadMessagesFromMessage(
            thread.messages,
            event.payload.messageId,
          );
          let messages = rollback.messages;
          const editedMessage = thread.messages.find(
            (message) => message.id === event.payload.messageId,
          );
          if (event.payload.replacementText !== undefined && editedMessage) {
            messages = [
              ...messages,
              {
                ...editedMessage,
                text: event.payload.replacementText,
                turnId: null,
                streaming: false,
                startsNewTurn: true,
                updatedAt: event.occurredAt,
              },
            ];
          }
          const removedTurnIds = new Set([
            ...rollback.removedTurnIds,
            ...(event.payload.removedTurnIds ?? []),
          ]);
          if (
            event.payload.replacementText === undefined &&
            messages.length === thread.messages.length &&
            removedTurnIds.size === 0
          ) {
            return thread;
          }

          const turnDiffSummaries = thread.turnDiffSummaries
            .filter((entry) => !removedTurnIds.has(entry.turnId))
            .toSorted(
              (left, right) =>
                (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
                (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
            );

          const activities = thread.activities.filter(
            (activity) => activity.turnId === null || !removedTurnIds.has(activity.turnId),
          );
          const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

          return {
            ...thread,
            turnDiffSummaries,
            messages: clearRemovedAsyncUserInputResponses(
              messages,
              new Set(messages.map((message) => message.id)),
              event.sequence,
            ).slice(-MAX_THREAD_MESSAGES),

            activities,

            latestHumanMessageAt: deriveThreadSummaryMetadata({
              ...thread,
              messages,
            }).latestHumanMessageAt,
            latestTurn:
              latestCheckpoint === null
                ? null
                : {
                    turnId: latestCheckpoint.turnId,
                    state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                    requestedAt: latestCheckpoint.completedAt,
                    startedAt: latestCheckpoint.completedAt,
                    completedAt: latestCheckpoint.completedAt,
                    assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                  },
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.archived":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => ({
          ...thread,
          archivedAt: event.payload.archivedAt ?? event.occurredAt,
          updatedAt: event.payload.updatedAt ?? event.occurredAt,
        }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.unarchived":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => ({
          ...thread,
          archivedAt: null,
          updatedAt: event.payload.updatedAt ?? event.occurredAt,
        }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    default:
      return state;
  }
}
