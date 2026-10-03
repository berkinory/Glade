import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ThreadHandoffImportedMessage } from "@glade/contracts/orchestration/commands";

const StoredPage = Schema.Struct({
  pageIndex: Schema.Number,
  cursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  messages: Schema.fromJsonString(Schema.Array(ThreadHandoffImportedMessage)),
  sourceIds: Schema.fromJsonString(Schema.Array(Schema.String)),
  applied: Schema.Number,
});
export type StoredImportPage = typeof StoredPage.Type;

export const makeProjectImportHistoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const initialize = (threadId: ThreadId, nativeId: string) => sql`
    INSERT INTO project_import_history (thread_id, native_id)
    SELECT ${threadId}, ${nativeId}
    WHERE EXISTS (SELECT 1 FROM projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL)
    ON CONFLICT(thread_id) DO NOTHING
  `;
  const identity = (threadId: ThreadId) =>
    sql<{ nativeId: string; revision: number }>`
    SELECT native_id AS "nativeId", revision FROM project_import_history WHERE thread_id = ${threadId}
  `.pipe(Effect.map((rows) => rows[0]));
  const pages = (threadId: ThreadId) =>
    sql`
    SELECT page_index AS "pageIndex", cursor, next_cursor AS "nextCursor",
      messages_json AS messages, source_ids_json AS "sourceIds", applied
    FROM project_import_history_pages WHERE thread_id = ${threadId} ORDER BY page_index
  `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredPage))));
  const save = (threadId: ThreadId, page: Omit<StoredImportPage, "applied">) => sql`
    INSERT INTO project_import_history_pages
      (thread_id, page_index, cursor, next_cursor, messages_json, source_ids_json)
    VALUES (${threadId}, ${page.pageIndex}, ${page.cursor}, ${page.nextCursor},
      ${JSON.stringify(page.messages)}, ${JSON.stringify(page.sourceIds)})
  `;
  const applied = (threadId: ThreadId, pageIndex: number) =>
    sql`
    UPDATE project_import_history_pages SET applied = 1
    WHERE thread_id = ${threadId} AND page_index = ${pageIndex}
  `.pipe(Effect.asVoid);
  return { initialize, identity, pages, save, applied };
});
export type ProjectImportHistoryRepository = Effect.Success<
  typeof makeProjectImportHistoryRepository
>;
