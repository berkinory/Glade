import type { ServiceMap } from "effect";
import {
  ProjectionTurnRepository,
  type ProjectionTurn,
} from "../../persistence/Services/ProjectionTurns.ts";
import { Effect, Option } from "effect";
import { settleTurnStateFromSession } from "../turnLifecycle.ts";
import { ProjectorDefinition } from "./projectorRegistration";
import { isInProgressTurnDiff } from "@glade/shared/threads/inProgressTurnDiff";
import {
  retainProjectionTurnsAfterRevert,
  retainTurnScopedProjectionRowsAfterConversationRollback,
} from "./historyPruning";

export function makeTurnProjector(input: {
  readonly projectionTurnRepository: ServiceMap.Service.Shape<typeof ProjectionTurnRepository>;
}) {
  const { projectionTurnRepository } = input;
  const applyThreadTurnsProjection: ProjectorDefinition["apply"] = (
    event,
    _attachmentSideEffects,
  ) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.deleted":
        case "thread.archived":
        case "thread.session-stop-requested":
          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        case "thread.claude-cache-set":
          if (event.payload.review?.status === "compacting") {
            yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
              threadId: event.payload.threadId,
            });
          }
          return;
        case "thread.claude-cache-response-requested":
          if (event.payload.decision === "cancel") {
            yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
              threadId: event.payload.threadId,
            });
          } else if (event.payload.decision === "continue") {
            yield* projectionTurnRepository.replacePendingTurnStart({
              threadId: event.payload.threadId,
              messageId: event.payload.review.messageId,

              requestedAt: event.payload.review.requestedAt ?? event.payload.review.createdAt,
            });
          }
          return;

        case "thread.turn-start-requested": {
          yield* projectionTurnRepository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,

            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (event.payload.session.status !== "running" || turnId === null) {
            const settledState = settleTurnStateFromSession(event.payload.session, "running");
            if (settledState !== null) {
              const openTurns = (yield* projectionTurnRepository.listByThreadId({
                threadId: event.payload.threadId,
              }))
                .filter(
                  (
                    row,
                  ): row is ProjectionTurn & {
                    turnId: Exclude<ProjectionTurn["turnId"], null>;
                  } => row.turnId !== null && row.completedAt === null,
                )
                .toSorted(
                  (left, right) =>
                    right.requestedAt.localeCompare(left.requestedAt) ||
                    right.turnId.localeCompare(left.turnId),
                );
              const turnToFinalize =
                (turnId === null ? undefined : openTurns.find((row) => row.turnId === turnId)) ??
                openTurns.at(0);

              if (turnToFinalize) {
                yield* projectionTurnRepository.upsertByTurnId({
                  ...turnToFinalize,
                  state:
                    settleTurnStateFromSession(event.payload.session, turnToFinalize.state) ??
                    turnToFinalize.state,
                  startedAt: turnToFinalize.startedAt ?? event.payload.session.updatedAt,
                  requestedAt: turnToFinalize.requestedAt ?? event.payload.session.updatedAt,
                  completedAt: event.payload.session.updatedAt,
                });
              }
            }
            return;
          }

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),

              startedAt:
                existingTurn.value.startedAt ?? event.payload.session.updatedAt ?? event.occurredAt,
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,

              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,

              startedAt: event.payload.session.updatedAt ?? event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            const existing = existingTurn.value;
            const existingIsTerminal =
              existing.state === "completed" ||
              existing.state === "error" ||
              existing.state === "interrupted";
            const nextTurn = {
              ...existing,
              assistantMessageId: event.payload.messageId,
              state: event.payload.streaming && !existingIsTerminal ? "running" : existing.state,
              completedAt:
                event.payload.streaming && !existingIsTerminal ? null : existing.completedAt,
              startedAt: existing.startedAt ?? event.payload.createdAt,
              requestedAt: existing.requestedAt ?? event.payload.createdAt,
            } satisfies ProjectionTurn;

            if (
              nextTurn.assistantMessageId === existing.assistantMessageId &&
              nextTurn.state === existing.state &&
              nextTurn.completedAt === existing.completedAt &&
              nextTurn.startedAt === existing.startedAt &&
              nextTurn.requestedAt === existing.requestedAt
            ) {
              return;
            }
            yield* projectionTurnRepository.upsertByTurnId(nextTurn);
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,

            assistantMessageId: event.payload.messageId,
            state: "running",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-interrupt-requested": {
          return;
        }

        case "thread.task-stop-requested": {
          return;
        }

        case "thread.task-background-requested": {
          return;
        }

        case "thread.turn-diff-completed": {
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const isInProgressDiff = isInProgressTurnDiff(event.payload);
          const nextState = isInProgressDiff
            ? Option.match(existingTurn, {
                onNone: () => "running" as const,
                onSome: (turn) => turn.state,
              })
            : event.payload.status === "error"
              ? "error"
              : "completed";
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              // Placeholder turn-diff events can fire before the assistant message is finalized; they must not
              // erase a real id recorded earlier by thread.message-sent.
              assistantMessageId:
                event.payload.assistantMessageId ?? existingTurn.value.assistantMessageId,
              state: nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: isInProgressDiff
                ? existingTurn.value.completedAt
                : event.payload.completedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,

            assistantMessageId: event.payload.assistantMessageId,
            state: nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: isInProgressDiff ? null : event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "thread.reverted":
        case "thread.conversation-rolled-back": {
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns =
            event.type === "thread.reverted"
              ? retainProjectionTurnsAfterRevert(existingTurns, event.payload.turnCount)
              : retainTurnScopedProjectionRowsAfterConversationRollback(
                  existingTurns,
                  new Set(event.payload.removedTurnIds ?? []),
                );
          if (
            event.type === "thread.conversation-rolled-back" &&
            keptTurns.length === existingTurns.length
          ) {
            return;
          }
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptTurns, (turn) =>
            turn.turnId === null
              ? event.type === "thread.reverted" ||
                turn.pendingMessageId === null ||
                turn.state !== "pending" ||
                turn.checkpointTurnCount !== null
                ? Effect.void
                : projectionTurnRepository.replacePendingTurnStart({
                    threadId: turn.threadId,
                    messageId: turn.pendingMessageId,

                    requestedAt: turn.requestedAt,
                  })
              : projectionTurnRepository.upsertByTurnId({
                  ...turn,
                  turnId: turn.turnId,
                }),
          );
          return;
        }

        default:
          return;
      }
    });
  return { applyThreadTurnsProjection };
}
