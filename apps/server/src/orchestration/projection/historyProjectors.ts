import type { ServiceMap } from "effect";

import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { Effect, Option } from "effect";
import { deriveTurnStartSession } from "../turnStartSession.ts";
import { ProjectorDefinition } from "./projectorRegistration";
import {
  retainTurnScopedProjectionRowsAfterRevert,
  retainTurnScopedProjectionRowsAfterConversationRollback,
} from "./historyPruning";

export function makeHistoryProjectors(input: {
  readonly projectionTurnRepository: ServiceMap.Service.Shape<typeof ProjectionTurnRepository>;
  readonly projectionThreadActivityRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadActivityRepository
  >;
  readonly projectionThreadSessionRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadSessionRepository
  >;
  readonly projectionThreadRepository: ServiceMap.Service.Shape<typeof ProjectionThreadRepository>;
}) {
  const {
    projectionTurnRepository,
    projectionThreadActivityRepository,
    projectionThreadSessionRepository,
    projectionThreadRepository,
  } = input;

  const applyThreadActivitiesProjection: ProjectorDefinition["apply"] = (
    event,
    _attachmentSideEffects,
  ) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.activity-appended":
          yield* projectionThreadActivityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,

            sequence: event.payload.activity.sequence ?? event.sequence,
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "thread.reverted":
        case "thread.conversation-rolled-back": {
          const existingRows = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const keptRows =
            event.type === "thread.reverted"
              ? retainTurnScopedProjectionRowsAfterRevert(
                  existingRows,
                  yield* projectionTurnRepository.listByThreadId({
                    threadId: event.payload.threadId,
                  }),
                  event.payload.turnCount,
                )
              : retainTurnScopedProjectionRowsAfterConversationRollback(
                  existingRows,
                  new Set(event.payload.removedTurnIds ?? []),
                );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert);
          return;
        }

        default:
          return;
      }
    });

  const applyThreadSessionsProjection: ProjectorDefinition["apply"] = (
    event,
    _attachmentSideEffects,
  ) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.turn-start-requested": {
          const [currentSession, thread] = yield* Effect.all([
            projectionThreadSessionRepository.getByThreadId({
              threadId: event.payload.threadId,
            }),
            projectionThreadRepository.getById({ threadId: event.payload.threadId }),
          ]);
          const turnStartSession = deriveTurnStartSession({
            threadId: event.payload.threadId,
            currentSession: Option.getOrNull(currentSession),
            providerName:
              Option.getOrNull(thread)?.modelSelection.provider ??
              Option.getOrNull(currentSession)?.providerName ??
              event.payload.modelSelection?.provider ??
              null,
            requestedRuntimeMode: event.payload.runtimeMode,
            requestedAt: event.payload.createdAt,
          });
          if (turnStartSession !== null) {
            yield* projectionThreadSessionRepository.upsert(turnStartSession);
          }
          return;
        }

        case "thread.session-set":
          yield* projectionThreadSessionRepository.upsert({
            threadId: event.payload.threadId,
            status: event.payload.session.status,
            providerName: event.payload.session.providerName,
            runtimeMode: event.payload.session.runtimeMode,
            activeTurnId: event.payload.session.activeTurnId,
            lastError: event.payload.session.lastError,
            updatedAt: event.payload.session.updatedAt,
          });
          return;

        default:
          return;
      }
    });
  return {
    applyThreadActivitiesProjection,
    applyThreadSessionsProjection,
  };
}
