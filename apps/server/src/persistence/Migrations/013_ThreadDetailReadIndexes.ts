import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Opening a long thread ranked every activity and read each row from disk to learn its turn and
// kind, and read every message-sent event payload for two identifiers. On a cold page cache that
// cost hundreds of milliseconds for a thread with ten thousand activities. The rank index now
// carries the turn and kind, so it replaces the narrower one, and the message references are
// answered from an expression index.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_rank_turn_kind
    ON projection_thread_activities(
      thread_id,
      (CASE WHEN sequence IS NULL THEN 0 ELSE 1 END) DESC,
      sequence DESC,
      created_at DESC,
      activity_id DESC,
      turn_id,
      kind
    )
  `;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_activities_thread_rank_desc`;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_events_message_sent_refs
    ON orchestration_events(
      event_type,
      stream_id,
      json_extract(payload_json, '$.messageId'),
      json_extract(payload_json, '$.providerMessageId'),
      sequence
    )
    WHERE event_type = 'thread.message-sent'
  `;
});
