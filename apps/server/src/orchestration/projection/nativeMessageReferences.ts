import { Effect, Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { MessageId, ThreadId, TrimmedNonEmptyString } from "@glade/contracts/core/baseSchemas";
import { toPersistenceSqlError, toPersistenceDecodeError } from "../../persistence/Errors.ts";

const Reference = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  providerMessageId: TrimmedNonEmptyString,
});

export function readNativeMessageReferences<
  T extends { readonly threadId: ThreadId; readonly messageId: MessageId },
>(sql: SqlClient.SqlClient, rows: ReadonlyArray<T>) {
  return Effect.gen(function* () {
    if (!rows.length) return rows;
    // Native identifiers are durable event data; existing databases need no new projection column.
    const references = yield* sql`
      SELECT aggregate_id AS "threadId", json_extract(payload_json, '$.messageId') AS "messageId",
        json_extract(payload_json, '$.providerMessageId') AS "providerMessageId"
      FROM orchestration_events
      WHERE event_type = 'thread.message-sent'
        AND aggregate_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(rows.map((row) => row.threadId))])}))
        AND json_extract(payload_json, '$.messageId') IN (SELECT value FROM json_each(${JSON.stringify(rows.map((row) => row.messageId))}))
        AND json_extract(payload_json, '$.providerMessageId') IS NOT NULL
      ORDER BY sequence ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("readNativeMessageReferences")),
      Effect.flatMap((values) =>
        Schema.decodeUnknownEffect(Schema.Array(Reference))(values).pipe(
          Effect.mapError(toPersistenceDecodeError("readNativeMessageReferences")),
        ),
      ),
    );
    const latest = new Map(
      references.map((reference) => [
        JSON.stringify([reference.threadId, reference.messageId]),
        reference.providerMessageId,
      ]),
    );
    return rows.map((row) => {
      const providerMessageId = latest.get(JSON.stringify([row.threadId, row.messageId]));
      return providerMessageId ? { ...row, providerMessageId } : row;
    });
  });
}
