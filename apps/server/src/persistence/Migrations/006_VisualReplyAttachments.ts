import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`PRAGMA table_info(managed_attachment_blobs)`;
  if (!columns.some((column) => column.name === "purpose")) {
    yield* sql`ALTER TABLE managed_attachment_blobs ADD COLUMN purpose TEXT CHECK (purpose IN ('visual-reply', 'visual-reply-preview'))`;
  }
});
