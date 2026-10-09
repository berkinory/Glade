import * as Crypto from "node:crypto";

import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const SHA256_HEX_LENGTH = 64;

// Pairing links stored their secret in plain text. Keep each link and replace the secret with the
// digest the server now looks it up by, so a link issued before the update still pairs.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ name: string }>`PRAGMA table_info(auth_pairing_links)`;
  if (columns.some((column) => column.name === "credential")) {
    yield* sql`ALTER TABLE auth_pairing_links RENAME COLUMN credential TO credential_hash`;
  }
  const rows = yield* sql<{ id: string; credentialHash: string }>`
    SELECT id, credential_hash AS "credentialHash" FROM auth_pairing_links
  `;
  for (const row of rows) {
    if (row.credentialHash.length === SHA256_HEX_LENGTH) continue;
    const digest = Crypto.createHash("sha256").update(row.credentialHash, "utf8").digest("hex");
    yield* sql`UPDATE auth_pairing_links SET credential_hash = ${digest} WHERE id = ${row.id}`;
  }
});
