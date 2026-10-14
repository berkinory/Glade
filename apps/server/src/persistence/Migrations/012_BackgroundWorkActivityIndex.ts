import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Background work reads only these task kinds for each thread's latest turn. Covering the turn and
// time filters lets SQLite skip every non-matching activity row; reading them made the first shell
// snapshot after a cold start spend hundreds of milliseconds on disk.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_background_work
    ON projection_thread_activities(kind, thread_id, turn_id, created_at)
    WHERE kind IN ('task.started', 'task.updated', 'task.progress', 'task.completed', 'background-work.reset')
  `;
});
