import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_thread_messages)`;
  if (!columns.some((column) => column.name === "model_selection_json"))
    yield* sql`ALTER TABLE projection_thread_messages ADD COLUMN model_selection_json TEXT`;
  // Resolve attribution from the journal at the first message event, never today's provider.
  yield* sql`
    UPDATE projection_thread_messages AS message
    SET model_selection_json = (
      SELECT json_extract(event.payload_json, '$.modelSelection')
      FROM orchestration_events AS event
      WHERE event.stream_id = message.thread_id
        AND event.sequence <= message.sequence
        AND json_extract(event.payload_json, '$.modelSelection.provider') IS NOT NULL
        AND event.event_type IN ('thread.created', 'thread.meta-updated', 'thread.message-sent')
      ORDER BY event.sequence DESC LIMIT 1
    )
    WHERE model_selection_json IS NULL AND source != 'handoff-import' AND source != 'fork-import'
  `;
});
