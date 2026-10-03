import { Data, Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { MessageId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { OrchestrationMessage } from "@glade/contracts/orchestration/threadEntities";
import type { ReadImportedHistoryInput } from "@glade/contracts/workspace/projectImport";
import { selectMessageTextChunks, joinMessageTextChunks } from "./messageTextChunks";
class ImportedHistoryError extends Data.TaggedError("ImportedHistoryError")<{
  readonly message: string;
}> {}

const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  threadId: Schema.String,
  sequence: Schema.Number,
});
const Row = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  encodedText: Schema.NullOr(Schema.fromJsonString(Schema.String)),
  textChunks: Schema.fromJsonString(Schema.Array(Schema.String)),
  sequence: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const makeProjectImportDisplayHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const encode = (threadId: ThreadId, sequence: number) =>
    Buffer.from(JSON.stringify({ version: 1, threadId, sequence })).toString("base64url");
  const read = Effect.fn(function* (input: ReadImportedHistoryInput) {
    const origins = yield* sql<{ status: string }>`
      SELECT o.status FROM project_import_origins o
      JOIN projection_threads t ON t.thread_id = o.thread_id
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE o.thread_id = ${input.threadId} AND t.deleted_at IS NULL AND p.deleted_at IS NULL
    `;
    if (origins.length === 0) {
      if (input.cursor !== null)
        return yield* new ImportedHistoryError({
          message: "The imported conversation is no longer available.",
        });
      return { messages: [], nextCursor: null };
    }
    if (origins[0]?.status !== "completed")
      return yield* new ImportedHistoryError({
        message: "Finish or retry this import before loading older messages.",
      });
    let sequence: number;
    if (input.cursor !== null) {
      const cursor = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Cursor))(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      ).pipe(
        Effect.mapError(
          () =>
            new ImportedHistoryError({
              message: "Invalid imported history cursor. Reopen the conversation.",
            }),
        ),
      );
      if (
        cursor.threadId !== input.threadId ||
        !Number.isSafeInteger(cursor.sequence) ||
        cursor.sequence < 0
      )
        return yield* new ImportedHistoryError({
          message: "This history cursor belongs to another conversation.",
        });
      sequence = cursor.sequence;
    } else {
      const rows = yield* sql<{ sequence: number }>`SELECT sequence FROM projection_thread_messages
        WHERE thread_id = ${input.threadId} AND message_id = ${input.beforeMessageId} AND sequence IS NOT NULL`;
      if (!rows[0])
        return yield* new ImportedHistoryError({
          message: "The history boundary changed. Reopen the conversation and retry.",
        });
      sequence = rows[0].sequence;
    }
    if (input.probe) {
      const older = yield* sql`SELECT 1 FROM projection_thread_messages
        WHERE thread_id = ${input.threadId} AND sequence < ${sequence}
          AND substr(message_id, 1, ${`import:${input.threadId}:`.length}) = ${`import:${input.threadId}:`}
        LIMIT 1`;
      return {
        messages: [],
        nextCursor: older.length > 0 ? encode(input.threadId, sequence) : null,
      };
    }
    const boundary = yield* sql`SELECT 1 FROM projection_thread_messages
      WHERE thread_id = ${input.threadId} AND sequence = ${sequence} LIMIT 1`;
    if (boundary.length === 0)
      return yield* new ImportedHistoryError({
        message: "The history boundary was removed. Reopen the conversation.",
      });
    const limit = input.limit ?? 100;
    const rows = yield* sql`
      SELECT message_id AS id, role, text, text_json AS "encodedText",
        ${selectMessageTextChunks(sql, "projection_thread_messages")}, sequence,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_thread_messages
      WHERE thread_id = ${input.threadId} AND sequence < ${sequence}
        AND substr(message_id, 1, ${`import:${input.threadId}:`.length}) = ${`import:${input.threadId}:`}
      ORDER BY sequence DESC LIMIT ${limit + 1}
    `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))));
    const messages: OrchestrationMessage[] = [];
    let bytes = 0;
    let lastSequence = sequence;
    for (const row of rows.slice(0, limit)) {
      const message: OrchestrationMessage = {
        id: row.id,
        role: row.role,
        text: joinMessageTextChunks(row),
        turnId: null,
        streaming: false,
        source: "native",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      const size = Buffer.byteLength(JSON.stringify(message), "utf8");
      if (size > 64 * 1024)
        return yield* new ImportedHistoryError({
          message:
            "An older imported message exceeds the 64 KiB display limit. Export the conversation to read its full contents.",
        });
      if (bytes + size > 2 * 1024 * 1024) break;
      bytes += size;
      lastSequence = row.sequence;
      messages.push(message);
    }
    return {
      messages: messages.toReversed(),
      nextCursor: rows.length > messages.length ? encode(input.threadId, lastSequence) : null,
    };
  });
  return (input: ReadImportedHistoryInput) => sql.withTransaction(read(input));
});
