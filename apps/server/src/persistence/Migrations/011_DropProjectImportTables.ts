import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// External project and conversation imports were removed, so nothing writes or reads these
// tables anymore. Measured databases held no rows in them.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TRIGGER IF EXISTS project_import_history_deleted`;
  yield* sql`DROP TABLE IF EXISTS project_import_history_pages`;
  yield* sql`DROP TABLE IF EXISTS project_import_history`;
  yield* sql`DROP TABLE IF EXISTS project_import_origins`;
});
