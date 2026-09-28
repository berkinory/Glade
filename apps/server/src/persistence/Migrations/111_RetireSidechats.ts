import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

// Side chats were short-lived child conversations. Remove them and their descendants
// before the 0.0.3 runtime starts; regular threads and their history are untouched.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_threads", "sidechat_source_thread_id"))) return;

  yield* sql`CREATE TEMP TABLE retired_sidechat_thread_ids (thread_id TEXT PRIMARY KEY)`;
  yield* sql`
    INSERT INTO retired_sidechat_thread_ids (thread_id)
    WITH RECURSIVE descendants(thread_id) AS (
      SELECT thread_id FROM projection_threads WHERE sidechat_source_thread_id IS NOT NULL
      UNION
      SELECT child.thread_id
      FROM projection_threads AS child
      JOIN descendants AS parent ON
        child.parent_thread_id = parent.thread_id OR
        child.fork_source_thread_id = parent.thread_id OR
        child.source_thread_id = parent.thread_id
    )
    SELECT thread_id FROM descendants
  `;

  yield* sql`
    DELETE FROM orchestration_command_receipts
    WHERE (aggregate_kind = 'thread'
      AND aggregate_id IN (SELECT thread_id FROM retired_sidechat_thread_ids))
      OR command_id IN (
      SELECT command_id FROM orchestration_events
      WHERE aggregate_kind = 'thread'
        AND stream_id IN (SELECT thread_id FROM retired_sidechat_thread_ids)
    )
  `;
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `;
  for (const { name } of tables) {
    if (name === "projection_threads" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const columns = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info(${name})`;
    const threadColumns = columns
      .map((column) => column.name)
      .filter((column) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(column) && column.endsWith("thread_id"));
    if (threadColumns.length === 0) continue;
    const predicate = threadColumns
      .map((column) => `"${column}" IN (SELECT thread_id FROM retired_sidechat_thread_ids)`)
      .join(" OR ");
    yield* sql.unsafe(`DELETE FROM "${name}" WHERE ${predicate}`);
  }

  yield* sql`
    DELETE FROM orchestration_events
    WHERE aggregate_kind = 'thread'
      AND stream_id IN (SELECT thread_id FROM retired_sidechat_thread_ids)
  `;
  yield* sql`
    DELETE FROM projection_threads
    WHERE thread_id IN (SELECT thread_id FROM retired_sidechat_thread_ids)
  `;
  yield* sql`DROP TABLE retired_sidechat_thread_ids`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN sidechat_source_thread_id`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN sidechat_last_activity_at`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN sidechat_expired_at`;
});
