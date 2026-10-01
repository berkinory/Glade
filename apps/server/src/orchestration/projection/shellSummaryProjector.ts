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

  readonly projectionPendingInteractionRepository: ProjectionPendingInteractionRepositoryShape;
}) {
  const [latestUserMessageAt, latestHumanMessageAt, pendingCounts] = yield* Effect.all([
    input.projectionThreadMessageRepository.getLatestUserMessageAt({
      threadId: input.thread.threadId,
    }),
    input.projectionThreadMessageRepository.getLatestHumanMessageAt({
      threadId: input.thread.threadId,
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
  } satisfies ProjectionThread;
});

export function makeShellSummaryProjector(input: {
  readonly updateThreadProjection: ReturnType<typeof makeThreadProjector>["updateThreadProjection"];
  readonly projectionThreadRepository: ServiceMap.Service.Shape<typeof ProjectionThreadRepository>;

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
          const nextRow = {
            ...existingRow.value,
            latestTurnId:
              event.type === "thread.session-set"
                ? event.payload.session.activeTurnId
                : event.payload.preserveLatestTurn
                  ? existingRow.value.latestTurnId
                  : event.payload.turnId,
            updatedAt: maxIso(existingRow.value.updatedAt, event.occurredAt),
          };
          yield* projectionThreadRepository.upsert(nextRow);
          return;
        }

        default:
          return;
      }
    });
  return { applyThreadShellSummariesProjection };
}
