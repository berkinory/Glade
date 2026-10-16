import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Profile no longer shows skill or per-model turn counts, so their purge archives have no reader.
// It now charts chats and agent time by local day, so purges keep each chat's start and each
// turn's active time.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS profile_stats_deleted_skills`;
  yield* sql`DROP TABLE IF EXISTS profile_stats_deleted_turns`;
  const threadColumns = yield* sql<{
    name: string;
  }>`PRAGMA table_info(profile_stats_deleted_threads)`;
  if (!threadColumns.some((column) => column.name === "created_at"))
    yield* sql`ALTER TABLE profile_stats_deleted_threads ADD COLUMN created_at TEXT`;
  yield* sql`CREATE TABLE IF NOT EXISTS profile_stats_deleted_agent_turns (
    thread_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    seconds INTEGER NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_profile_stats_deleted_agent_turns_thread
    ON profile_stats_deleted_agent_turns(thread_id)`;
});
