import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS thread_pull_request_watches (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    cwd TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event TEXT,
    state_json TEXT NOT NULL
  )`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS thread_pull_request_watches_deleted
    AFTER UPDATE OF deleted_at ON projection_threads
    WHEN NEW.deleted_at IS NOT NULL
    BEGIN
      DELETE FROM thread_pull_request_watches WHERE thread_id = NEW.thread_id;
    END`;
});
