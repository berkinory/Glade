import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlStatement from "effect/unstable/sql/Statement";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Schema, Effect } from "effect";
import {
  ProjectionThreadMessageDbRowSchema,
  type ProjectionThreadMessageDbRow,
} from "../../persistence/projectionThreadMessageRow.ts";
import {
  selectMessageTextChunks,
  selectSegmentEndedAt,
} from "../../persistence/messageTextChunks.ts";
import { ThreadId, MessageId } from "@glade/contracts/core/baseSchemas";
import { ProjectionThreadMessageSegmentDbRow } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { toPersistenceSqlOrDecodeError } from "../../persistence/Errors.ts";
import {
  MAX_THREAD_MESSAGES,
  ThreadMessagesByThreadLookupInput,
  ThreadIdLookupInput,
} from "./snapshotSchemas";

export function makeSnapshotMessageQueries(input: {
  readonly sql: SqlClient.SqlClient;
  readonly liveThreadScope: SqlStatement.Statement<SqlConnection.Row>;
}) {
  const { sql, liveThreadScope } = input;
  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          text_json AS "encodedText",
          ${selectMessageTextChunks(sql, "projection_thread_messages")},
          attachments_json AS "attachments",
          skills_json AS "skills",
          mentions_json AS "mentions",
          dispatch_mode AS "dispatchMode",
          dispatch_origin AS "dispatchOrigin",
          starts_new_turn AS "startsNewTurn",
          async_user_input_json AS "asyncUserInput",
          is_streaming AS "isStreaming",
          source,
          sequence,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM (
          SELECT
            thread_id,
            message_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                message_id DESC
            ) AS message_rank
          FROM projection_thread_messages
          WHERE ${liveThreadScope}
        ) AS ranks
        JOIN projection_thread_messages USING (thread_id, message_id)
        WHERE message_rank <= ${MAX_THREAD_MESSAGES}
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          message_id ASC
      `,
  });

  const listThreadMessageSegmentRows = SqlSchema.findAll({
    Request: Schema.Array(Schema.Struct({ threadId: ThreadId, messageId: MessageId })),
    Result: ProjectionThreadMessageSegmentDbRow,
    execute: (messages) =>
      sql`
        SELECT
          segments.thread_id AS "threadId",
          segments.message_id AS "messageId",
          segments.sequence,
          segments.started_at AS "startedAt",
          ${selectSegmentEndedAt(sql, "segments")},
          segments.text,
          segments.text_json AS "encodedText",
          ${selectMessageTextChunks(sql, "segments", true)}
        FROM json_each(${JSON.stringify(messages)}) AS selected
        JOIN message_text_segments AS segments
          ON segments.thread_id = json_extract(selected.value, '$.threadId')
          AND segments.message_id = json_extract(selected.value, '$.messageId')
        ORDER BY segments.sequence ASC, segments.message_id ASC
      `,
  });

  const loadMessageSegments = (
    messages: ReadonlyArray<ProjectionThreadMessageDbRow>,
    tracePrefix: string,
  ) =>
    listThreadMessageSegmentRows(
      messages.map(({ threadId, messageId }) => ({ threadId, messageId })),
    ).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          `${tracePrefix}:listMessageSegments:query`,
          `${tracePrefix}:listMessageSegments:decodeRows`,
        ),
      ),
    );

  const listThreadMessageRowsByThread = SqlSchema.findAll({
    Request: ThreadMessagesByThreadLookupInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId, maxMessages }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          text_json AS "encodedText",
          ${selectMessageTextChunks(sql, "projection_thread_messages")},
          attachments_json AS "attachments",
          skills_json AS "skills",
          mentions_json AS "mentions",
          dispatch_mode AS "dispatchMode",
          dispatch_origin AS "dispatchOrigin",
          starts_new_turn AS "startsNewTurn",
          async_user_input_json AS "asyncUserInput",
          is_streaming AS "isStreaming",
          source,
          sequence,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM (
          SELECT
            thread_id,
            message_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                message_id DESC
            ) AS message_rank
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
        ) AS ranks
        JOIN projection_thread_messages USING (thread_id, message_id)
        WHERE thread_id = ${threadId}
          AND (${maxMessages} IS NULL OR message_rank <= ${maxMessages})
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          message_id ASC
      `,
  });

  const countThreadMessageRows = SqlSchema.findOne({
    Request: ThreadIdLookupInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ threadId }) =>
      sql`
        SELECT COUNT(*) AS count
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `,
  });
  return {
    listThreadMessageRows,
    loadMessageSegments,
    listThreadMessageRowsByThread,
    countThreadMessageRows,
  };
}
