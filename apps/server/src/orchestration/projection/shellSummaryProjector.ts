import { Effect, Option } from "effect";
import {
  type ProjectionThread,
  ProjectionThreadRepository,
} from "../../persistence/Services/ProjectionThreads.ts";
import {
  type ProjectionThreadMessageRepositoryShape,
  ProjectionThreadMessageRepository,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  type ProjectionThreadProposedPlanRepositoryShape,
  ProjectionThreadProposedPlanRepository,
} from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import {
  type ProjectionPendingInteractionRepositoryShape,
  ProjectionPendingInteractionRepository,
} from "../../persistence/Services/ProjectionPendingInteractions.ts";
import type { ServiceMap } from "effect";
import { shouldApplyDeferredThreadShellSummary } from "../threadShellEvents.ts";
import { resolveHumanMessageAt } from "@glade/shared/threads/threadSummary";
import { maxIso } from "../turnLifecycle.ts";
import { makeThreadProjector } from "./threadProjector";
import { ProjectorDefinition } from "./projectorRegistration";

const withRebuiltThreadShellSummary = Effect.fn(function* (input: {
  readonly thread: ProjectionThread;
  readonly projectionThreadMessageRepository: ProjectionThreadMessageRepositoryShape;
  readonly projectionThreadProposedPlanRepository: ProjectionThreadProposedPlanRepositoryShape;
  readonly projectionPendingInteractionRepository: ProjectionPendingInteractionRepositoryShape;
}) {
  const [latestUserMessageAt, latestHumanMessageAt, latestPlan, pendingCounts] = yield* Effect.all([
    input.projectionThreadMessageRepository.getLatestUserMessageAt({
      threadId: input.thread.threadId,
    }),
    input.projectionThreadMessageRepository.getLatestHumanMessageAt({
      threadId: input.thread.threadId,
    }),
    input.projectionThreadProposedPlanRepository.getLatestSummaryByThreadId({
      threadId: input.thread.threadId,
      preferredTurnId: input.thread.latestTurnId,
    }),
    input.projectionPendingInteractionRepository.getPendingCountsByThreadId({
      threadId: input.thread.threadId,
    }),
  ]);

  return {
    ...input.thread,
    latestUserMessageAt,
    latestHumanMessageAt,
    pendingApprovalCount: pendingCounts.pendingApprovalCount,
    pendingUserInputCount: pendingCounts.pendingUserInputCount,
    hasActionableProposedPlan:
      Option.isSome(latestPlan) && latestPlan.value.implementedAt === null ? 1 : 0,
  } satisfies ProjectionThread;
});

const withRefreshedActionablePlanSummary = Effect.fn(function* (input: {
  readonly thread: ProjectionThread;
  readonly projectionThreadProposedPlanRepository: ProjectionThreadProposedPlanRepositoryShape;
}) {
  const latestPlan = yield* input.projectionThreadProposedPlanRepository.getLatestSummaryByThreadId(
    {
      threadId: input.thread.threadId,
      preferredTurnId: input.thread.latestTurnId,
    },
  );
  return {
    ...input.thread,
    hasActionableProposedPlan:
      Option.isSome(latestPlan) && latestPlan.value.implementedAt === null ? 1 : 0,
  } satisfies ProjectionThread;
});

export function makeShellSummaryProjector(input: {
  readonly updateThreadProjection: ReturnType<typeof makeThreadProjector>["updateThreadProjection"];
  readonly projectionThreadRepository: ServiceMap.Service.Shape<typeof ProjectionThreadRepository>;
  readonly projectionThreadProposedPlanRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadProposedPlanRepository
  >;
  readonly projectionThreadMessageRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadMessageRepository
  >;
  readonly projectionPendingInteractionRepository: ServiceMap.Service.Shape<
    typeof ProjectionPendingInteractionRepository
  >;
}) {
  const {
    updateThreadProjection,
    projectionThreadRepository,
    projectionThreadProposedPlanRepository,
    projectionThreadMessageRepository,
    projectionPendingInteractionRepository,
  } = input;
  const applyThreadShellSummariesProjection: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.message-sent": {
          if (!shouldApplyDeferredThreadShellSummary(event)) {
            return;
          }
          const humanMessageAt = resolveHumanMessageAt(event.payload);
          return yield* updateThreadProjection(event.payload.threadId, (thread) => ({
            ...thread,
            latestUserMessageAt: maxIso(thread.latestUserMessageAt, event.payload.createdAt),
            latestHumanMessageAt:
              humanMessageAt === null
                ? (thread.latestHumanMessageAt ?? null)
                : maxIso(thread.latestHumanMessageAt ?? null, humanMessageAt),
            updatedAt: event.occurredAt,
          }));
        }

        case "thread.proposed-plan-upserted": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const nextRow = yield* withRefreshedActionablePlanSummary({
            thread: {
              ...existingRow.value,
              updatedAt: event.occurredAt,
            },
            projectionThreadProposedPlanRepository,
          });
          yield* projectionThreadRepository.upsert(nextRow);
          return;
        }

        case "thread.reverted":
        case "thread.conversation-rolled-back": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const nextRow = yield* withRebuiltThreadShellSummary({
            thread: {
              ...existingRow.value,
              latestTurnId: null,
              updatedAt: event.occurredAt,
            },
            projectionThreadMessageRepository,
            projectionThreadProposedPlanRepository,
            projectionPendingInteractionRepository,
          });
          yield* projectionThreadRepository.upsert(nextRow);
          return;
        }

        case "thread.session-set":
        case "thread.turn-diff-completed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const nextRow = yield* withRefreshedActionablePlanSummary({
            thread: {
              ...existingRow.value,
              latestTurnId:
                event.type === "thread.session-set"
                  ? event.payload.session.activeTurnId
                  : event.payload.preserveLatestTurn
                    ? existingRow.value.latestTurnId
                    : event.payload.turnId,
              updatedAt: maxIso(existingRow.value.updatedAt, event.occurredAt),
            },
            projectionThreadProposedPlanRepository,
          });
          yield* projectionThreadRepository.upsert(nextRow);
          return;
        }

        default:
          return;
      }
    });
  return { applyThreadShellSummariesProjection };
}
