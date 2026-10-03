import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS project_import_history (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    native_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS project_import_history_pages (
    thread_id TEXT NOT NULL REFERENCES project_import_history(thread_id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    cursor TEXT,
    next_cursor TEXT,
    messages_json TEXT NOT NULL,
    source_ids_json TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, page_index)
  )`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS project_import_history_deleted
    AFTER UPDATE OF deleted_at ON projection_threads
    WHEN NEW.deleted_at IS NOT NULL
    BEGIN
      DELETE FROM project_import_history_pages WHERE thread_id = NEW.thread_id;
      DELETE FROM project_import_history WHERE thread_id = NEW.thread_id;
    END`;
});
