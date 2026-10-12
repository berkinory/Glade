import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// A provider switch parks the previous provider's native session here instead of discarding it, so
// returning to that provider resumes its own conversation and only receives what happened meanwhile.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_parked_sessions (
      thread_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      resume_cursor_json TEXT NOT NULL,
      last_seen_message_id TEXT,
      parked_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, provider_name)
    )
  `;
});
