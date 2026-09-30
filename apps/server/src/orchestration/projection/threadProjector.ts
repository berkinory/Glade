import type { ServiceMap } from "effect";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThreadMessageRepository } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { Effect, Option } from "effect";
import {
  addPinnedMessage,
  removePinnedMessage,
  setPinnedMessageDone,
  setPinnedMessageLabel,
} from "@glade/shared/threads/pinnedMessages";
import { deriveTurnStartModelSelection, canAdoptFirstTurnProvider } from "../turnStartSession.ts";
import { maxIso } from "../turnLifecycle.ts";
import { ProjectorDefinition } from "./projectorRegistration";

export function makeThreadProjector(input: {
  readonly projectionThreadRepository: ServiceMap.Service.Shape<typeof ProjectionThreadRepository>;
  readonly projectionThreadSessionRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadSessionRepository
  >;
  readonly projectionThreadMessageRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadMessageRepository
  >;
}) {
  const {
    projectionThreadRepository,
    projectionThreadSessionRepository,
    projectionThreadMessageRepository,
  } = input;
  const updateThreadProjection = Effect.fnUntraced(function* (
    threadId: ProjectionThread["threadId"],
    update: (thread: ProjectionThread) => ProjectionThread,
  ) {
    const existing = yield* projectionThreadRepository.getById({ threadId });
    if (Option.isSome(existing)) {
      yield* projectionThreadRepository.upsert(update(existing.value));
    }
  });

  const applyThreadsProjection: ProjectorDefinition["apply"] = (event, attachmentSideEffects) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.created": {
          yield* projectionThreadRepository.upsert({
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            modelSelection: event.payload.modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            envMode: event.payload.envMode ?? "local",
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            workingDirectory: event.payload.workingDirectory ?? null,
            associatedWorktreePath: event.payload.associatedWorktreePath ?? null,
            associatedWorktreeBranch: event.payload.associatedWorktreeBranch ?? null,
            associatedWorktreeRef: event.payload.associatedWorktreeRef ?? null,
            createBranchFlowCompleted: event.payload.createBranchFlowCompleted ?? false,
            isPinned: event.payload.isPinned ?? false,
            parentThreadId: event.payload.parentThreadId ?? null,
            creationSource: event.payload.creationSource ?? null,
            sourceThreadId: event.payload.sourceThreadId ?? null,
            sourceTurnId: event.payload.sourceTurnId ?? null,
            gatewayOperationId: event.payload.gatewayOperationId ?? null,
            gatewayOperationIndex: event.payload.gatewayOperationIndex ?? null,
            subagentAgentId: event.payload.subagentAgentId ?? null,
            subagentNickname: event.payload.subagentNickname ?? null,
            subagentRole: event.payload.subagentRole ?? null,
            forkSourceThreadId: event.payload.forkSourceThreadId,
            lastKnownPr: event.payload.lastKnownPr ?? null,
            latestTurnId: null,
            handoff: event.payload.handoff,
            pinnedMessages: null,
            notes: null,
            goal: null,
            goalStartedAt: null,
            goalPausedAt: null,
            goalAchievements: null,
            latestUserMessageAt: null,
            latestHumanMessageAt: null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: 0,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            settledAt: null,
            deletedAt: null,
          });
          return;
        }

        case "thread.meta-updated": {
          return yield* updateThreadProjection(event.payload.threadId, (thread) => {
            const nextCreateBranchFlowCompleted =
              event.payload.createBranchFlowCompleted !== undefined
                ? event.payload.createBranchFlowCompleted
                : event.payload.branch !== undefined && event.payload.branch !== thread.branch
                  ? false
                  : undefined;
            return {
              ...thread,
              ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
              ...(event.payload.modelSelection !== undefined
                ? { modelSelection: event.payload.modelSelection }
                : {}),
              ...(event.payload.envMode !== undefined ? { envMode: event.payload.envMode } : {}),
              ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
              ...(event.payload.worktreePath !== undefined
                ? { worktreePath: event.payload.worktreePath }
                : {}),
              ...(event.payload.workingDirectory !== undefined
                ? { workingDirectory: event.payload.workingDirectory }
                : {}),
              ...(event.payload.associatedWorktreePath !== undefined
                ? { associatedWorktreePath: event.payload.associatedWorktreePath }
                : {}),
              ...(event.payload.associatedWorktreeBranch !== undefined
                ? { associatedWorktreeBranch: event.payload.associatedWorktreeBranch }
                : {}),
              ...(event.payload.associatedWorktreeRef !== undefined
                ? { associatedWorktreeRef: event.payload.associatedWorktreeRef }
                : {}),
              ...(nextCreateBranchFlowCompleted !== undefined
                ? { createBranchFlowCompleted: nextCreateBranchFlowCompleted }
                : {}),
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
                ? { pinnedMessages: event.payload.pinnedMessages }
                : {}),

              ...(event.payload.notes !== undefined ? { notes: event.payload.notes } : {}),
              ...(event.payload.goal !== undefined ? { goal: event.payload.goal } : {}),
              ...(event.payload.goalStartedAt !== undefined
                ? { goalStartedAt: event.payload.goalStartedAt }
                : {}),
              ...(event.payload.goalPausedAt !== undefined
                ? { goalPausedAt: event.payload.goalPausedAt }
                : {}),
              ...(event.payload.goalAchievements !== undefined
                ? { goalAchievements: event.payload.goalAchievements }
                : {}),
              updatedAt: event.payload.updatedAt,
            };
          });
        }

        case "thread.pinned-message-added":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            pinnedMessages: addPinnedMessage(thread.pinnedMessages, event.payload.pin),
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.pinned-message-removed":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            pinnedMessages: removePinnedMessage(thread.pinnedMessages, event.payload.messageId),
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.pinned-message-done-set":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            pinnedMessages: setPinnedMessageDone(
              thread.pinnedMessages,
              event.payload.messageId,
              event.payload.done,
            ),
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.pinned-message-label-set":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            pinnedMessages: setPinnedMessageLabel(
              thread.pinnedMessages,
              event.payload.messageId,
              event.payload.label,
            ),
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.claude-cache-set":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            claudeCacheReview: event.payload.review,
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.runtime-mode-set":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            runtimeMode: event.payload.runtimeMode,
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.interaction-mode-set":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.updatedAt,
          }));

        case "thread.turn-start-requested": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          const hasLatestTurn = existingRow.value.latestTurnId !== null;
          const hasSession = Option.isSome(session);
          // `canAdoptFirstTurnProvider` only consults the transcript on a brand-new thread (no turn, no
          // session). This projector runs inside the hot turn-start commit, so an established thread must not
          // pay a full transcript + text-segment load just to have it discarded.
          const messages =
            hasLatestTurn || hasSession
              ? []
              : yield* projectionThreadMessageRepository.listByThreadId({
                  threadId: event.payload.threadId,
                });
          const projectedModelSelection = deriveTurnStartModelSelection({
            currentModelSelection: existingRow.value.modelSelection,
            requestedModelSelection: event.payload.modelSelection,
            canAdoptRequestedProvider: canAdoptFirstTurnProvider({
              hasLatestTurn,
              hasSession,
              messages,
            }),
          });
          // Automation-dispatched turns run with the automation's modes but must not repaint the thread's
          // persisted modes: on a heartbeat target thread the user's own composer selection has to survive
          // the automation turn.
          const adoptTurnModes = event.payload.dispatchOrigin !== "automation";
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(projectedModelSelection !== existingRow.value.modelSelection
              ? { modelSelection: projectedModelSelection }
              : {}),
            ...(adoptTurnModes
              ? {
                  runtimeMode: event.payload.runtimeMode,
                  interactionMode: event.payload.interactionMode,
                }
              : {}),
            updatedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.session-set":
        case "thread.turn-diff-completed":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            updatedAt: maxIso(thread.updatedAt, event.occurredAt),
          }));

        case "thread.deleted": {
          attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          }));
        }

        case "thread.archived": {
          const archivedAt =
            event.payload.archivedAt ?? event.payload.updatedAt ?? event.occurredAt;
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            archivedAt,
            updatedAt: event.payload.updatedAt ?? archivedAt,
          }));
        }

        case "thread.unarchived":
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            archivedAt: null,
            updatedAt: event.payload.updatedAt ?? event.payload.unarchivedAt ?? event.occurredAt,
          }));

        default:
          return;
      }
    });
  return { updateThreadProjection, applyThreadsProjection };
}
