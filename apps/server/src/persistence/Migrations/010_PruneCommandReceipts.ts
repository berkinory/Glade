import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Receipts are looked up only by command id. A provider receipt (`provider:<eventId>:…`) only dedupes
// a replay of its runtime journal row, so once the retention sweep removed that row it can never match
// again. The sweep deletes both together; this clears receipts whose rows were swept earlier.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP INDEX IF EXISTS idx_orch_command_receipts_aggregate`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_command_receipts_sequence`;
  yield* sql`
    DELETE FROM orchestration_command_receipts
    WHERE command_id >= 'provider:' AND command_id < 'provider;'
      AND command_id NOT LIKE 'provider:native-child-overflow:%'
      AND rowid NOT IN (
        SELECT receipt.rowid
        FROM provider_runtime_events AS event
        JOIN orchestration_command_receipts AS receipt
          ON receipt.command_id >= 'provider:' || event.event_id || ':'
         AND receipt.command_id < 'provider:' || event.event_id || ';'
      )
  `;
});
