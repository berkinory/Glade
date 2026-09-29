import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// After the fix that adds `thread.session-set` and `thread.turn-diff-completed` to the hot threads
// projector, an existing `projection.threads` cursor that is already past those events will never
// backfill them.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_state
    WHERE projector = 'projection.threads'
  `;
});
