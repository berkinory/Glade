import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`PRAGMA table_info(orchestration_command_receipts)`;
  if (!columns.some((column) => column.name === "owner_kind"))
    yield* sql`ALTER TABLE orchestration_command_receipts ADD COLUMN owner_kind TEXT`;
  if (!columns.some((column) => column.name === "owner_id"))
    yield* sql`ALTER TABLE orchestration_command_receipts ADD COLUMN owner_id TEXT`;
});
