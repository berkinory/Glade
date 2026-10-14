import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS chat_image_snapshots (
    name TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    touched_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS chat_image_snapshot_references (
    thread_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('message', 'activity')),
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    capture_key TEXT,
    PRIMARY KEY (thread_id, owner_kind, owner_id, name)
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_chat_image_snapshot_references_name
    ON chat_image_snapshot_references(name)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_chat_image_snapshot_references_capture
    ON chat_image_snapshot_references(thread_id, capture_key)`;
});
