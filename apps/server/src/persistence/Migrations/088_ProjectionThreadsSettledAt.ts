import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const [column] = yield* sql<{ readonly exists: number }>`
    SELECT EXISTS(
      SELECT 1
      FROM pragma_table_info('projection_threads')
      WHERE name = 'settled_at'
    ) AS "exists"
  `;
  if (column?.exists !== 1) {
    // Only the explicit already-present case is idempotent; locks, read-only databases, and I/O
    // failures must leave the migration pending so a later startup can retry instead of recording a
    // schema change that never happened.
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN settled_at TEXT
    `;
  }
});
