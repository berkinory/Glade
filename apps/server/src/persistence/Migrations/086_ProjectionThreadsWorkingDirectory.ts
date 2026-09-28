// Purpose: Add the thread working-directory column used by local environments.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_threads", "working_directory"))) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN working_directory TEXT
    `;
  }
});
