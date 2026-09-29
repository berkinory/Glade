import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* columnExists(sql, "provider_session_runtime", "lifecycle_generation"))) {
    yield* sql`
      ALTER TABLE provider_session_runtime
      ADD COLUMN lifecycle_generation TEXT NOT NULL DEFAULT 'legacy'
    `;
  }
});
