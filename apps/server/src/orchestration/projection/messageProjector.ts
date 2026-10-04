import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { ServiceMap } from "effect";
import { ProjectionThreadMessageRepository } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import {
  makeMessageTextChunks,
  encodeMessageTextFallback,
} from "../../persistence/messageTextChunks.ts";
import { Effect, Option } from "effect";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { resolveStableMessageTurnId } from "../messageTurnId.ts";
import { clearRemovedAsyncUserInputResponses } from "@glade/shared/threads/asyncUserInput";
import { ProjectorDefinition } from "./projectorRegistration";
import {
  retainProjectionMessagesAfterRevert,
  rollbackProjectionMessagesFromMessage,
} from "./historyPruning";
import { collectThreadAttachmentRelativePaths } from "./attachmentEffects";

export function makeMessageProjector(input: {
  readonly sql: SqlClient.SqlClient;
  readonly projectionThreadMessageRepository: ServiceMap.Service.Shape<
    typeof ProjectionThreadMessageRepository
  >;
  readonly projectionTurnRepository: ServiceMap.Service.Shape<typeof ProjectionTurnRepository>;
}) {
  const { sql, projectionThreadMessageRepository, projectionTurnRepository } = input;
  const messageTextChunks = makeMessageTextChunks(sql);

  const applyThreadMessagesProjection: ProjectorDefinition["apply"] = (
    event,
    attachmentSideEffects,
  ) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.async-user-input-answered": {
          const existingMessage = yield* projectionThreadMessageRepository.getByThreadAndMessageId({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
          });
          if (Option.isSome(existingMessage) && existingMessage.value.asyncUserInput) {
            yield* projectionThreadMessageRepository.upsert({
              ...existingMessage.value,
              asyncUserInput: {
                ...existingMessage.value.asyncUserInput,
                response: event.payload.response,
                responseSequence: event.sequence,
              },
            });
          }
          return;
        }
        case "thread.message-sent": {
          if (event.payload.role === "assistant") {
            if (event.payload.streaming) {
              yield* messageTextChunks.append(event);
              return;
            }
            if (yield* messageTextChunks.hasApplied(event)) return;
          }
          const existingMessage = yield* projectionThreadMessageRepository.getByThreadAndMessageId({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
          });
          const resolvedText =
            Option.isSome(existingMessage) && event.payload.streaming
              ? `${existingMessage.value.text}${event.payload.text}`
              : Option.isSome(existingMessage) && event.payload.text.length === 0
                ? existingMessage.value.text
                : event.payload.text;
          if (!event.payload.streaming && event.payload.role === "assistant") {
            const segments = Option.isSome(existingMessage)
              ? (existingMessage.value.textSegments ?? [])
              : [];
            if (
              segments.length > 1 &&
              segments.map((segment) => segment.text).join("") === resolvedText
            ) {
              for (const [index, segment] of segments.entries()) {
                yield* sql`UPDATE message_text_segments SET text = ${segment.text},
                  text_json = ${encodeMessageTextFallback(segment.text)},
                  ended_at = ${index === segments.length - 1 ? event.payload.updatedAt : segment.endedAt}
                  WHERE thread_id = ${event.payload.threadId} AND message_id = ${event.payload.messageId} AND sequence = ${segment.sequence}`.pipe(
                  Effect.mapError(
                    toPersistenceSqlError("ProjectionPipeline.materializeMessageTextSegments"),
                  ),
                );
              }
            } else {
              yield* sql`DELETE FROM message_text_segments WHERE thread_id = ${event.payload.threadId} AND message_id = ${event.payload.messageId}`.pipe(
                Effect.mapError(
                  toPersistenceSqlError("ProjectionPipeline.deleteMessageTextSegments"),
                ),
              );
            }
          }
          const nextAttachments =
            event.payload.attachments !== undefined
              ? event.payload.attachments
              : Option.isSome(existingMessage)
                ? existingMessage.value.attachments
                : undefined;
          yield* projectionThreadMessageRepository.upsert({
            messageId: event.payload.messageId,
            threadId: event.payload.threadId,
            turnId: resolveStableMessageTurnId({
              existingTurnId: Option.isSome(existingMessage) ? existingMessage.value.turnId : null,
              incomingTurnId: event.payload.turnId,
            }),
            role: event.payload.role,
            text: resolvedText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            ...(event.payload.skills !== undefined ? { skills: event.payload.skills } : {}),
            ...(event.payload.mentions !== undefined ? { mentions: event.payload.mentions } : {}),
            ...(event.payload.asyncUserInput !== undefined
              ? { asyncUserInput: event.payload.asyncUserInput }
              : {}),
            ...(event.payload.dispatchMode !== undefined
              ? { dispatchMode: event.payload.dispatchMode }
              : {}),
            ...(event.payload.dispatchOrigin !== undefined
              ? { dispatchOrigin: event.payload.dispatchOrigin }
              : {}),
            ...(event.payload.startsNewTurn !== undefined
              ? { startsNewTurn: event.payload.startsNewTurn }
              : {}),
            isStreaming: event.payload.streaming,
            source: event.payload.source,
            ...(event.payload.modelSelection
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            sequence: Option.isSome(existingMessage)
              ? (existingMessage.value.sequence ?? event.sequence)
              : event.sequence,
            createdAt:
              (Option.isSome(existingMessage) ? existingMessage.value.createdAt : null) ??
              event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          if (event.payload.role === "assistant") yield* messageTextChunks.settle(event);
          return;
        }

        case "thread.reverted":
        case "thread.conversation-rolled-back": {
          if (
            event.type === "thread.conversation-rolled-back" &&
            event.payload.numTurns === 0 &&
            event.payload.replacementText === undefined
          ) {
            return;
          }
          const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          let keptRows: typeof existingRows;
          if (event.type === "thread.reverted") {
            keptRows = retainProjectionMessagesAfterRevert(
              existingRows,
              yield* projectionTurnRepository.listByThreadId({
                threadId: event.payload.threadId,
              }),
              event.payload.turnCount,
            );
            if (keptRows.length === existingRows.length) {
              return;
            }
          } else {
            const rollback = rollbackProjectionMessagesFromMessage(
              existingRows,
              event.payload.messageId,
            );
            if (!rollback.changed) {
              return;
            }
            keptRows = rollback.keptRows;
            const editedMessage = existingRows.find(
              (message) => message.messageId === event.payload.messageId,
            );
            if (event.payload.replacementText !== undefined && editedMessage) {
              keptRows = [
                ...keptRows,
                {
                  ...editedMessage,
                  text: event.payload.replacementText,
                  turnId: null,
                  isStreaming: false,
                  startsNewTurn: true,
                  updatedAt: event.occurredAt,
                },
              ];
            }
          }

          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          keptRows = clearRemovedAsyncUserInputResponses(
            keptRows,
            new Set(keptRows.map((message) => message.messageId)),
            event.sequence,
          );
          yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert);

          yield* sql`UPDATE projection_thread_messages SET text_event_sequence = ${event.sequence}
            WHERE thread_id = ${event.payload.threadId}`.pipe(
            Effect.mapError(toPersistenceSqlError("ProjectionPipeline.retainMessageTextSequence")),
          );

          if (event.type === "thread.reverted" || event.payload.skipAttachmentPrune !== true) {
            attachmentSideEffects.prunedThreadRelativePaths.set(
              event.payload.threadId,
              collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
            );
          }
          return;
        }

        default:
          return;
      }
    });
  return { applyThreadMessagesProjection };
}
