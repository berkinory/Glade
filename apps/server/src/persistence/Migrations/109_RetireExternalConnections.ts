import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP VIEW IF EXISTS external_mcp_active_capacity_claims`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_tasks`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_audit_log`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_rate_windows`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_pairing_codes`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_integration_projects`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_operations`;
  yield* sql`DROP TABLE IF EXISTS external_mcp_integrations`;
});
