import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP INDEX IF EXISTS idx_orch_events_command_id`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_events_correlation_id`;
});
