import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { MigrationSchemaTooNewError } from "./Errors.ts";
import Baseline from "./Migrations/112_Baseline.ts";

export const migrationEntries = [[112, "Baseline", Baseline]] as const;

const LATEST_MIGRATION_ID = Math.max(...migrationEntries.map(([id]) => id));

const loader = Migrator.fromRecord(
  Object.fromEntries(migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
);
const run = Migrator.make({});

export const runMigrations = () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const tracker = yield* sql`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'effect_sql_migrations'
    `;
    if (tracker.length > 0) {
      const rows = yield* sql<{ readonly id: number | null }>`
        SELECT MAX(migration_id) AS id FROM effect_sql_migrations
      `;
      const id = rows[0]?.id ?? 0;
      if (id > LATEST_MIGRATION_ID) {
        return yield* Effect.fail(
          new MigrationSchemaTooNewError({
            databaseMigrationId: id,
            latestSupportedMigrationId: LATEST_MIGRATION_ID,
          }),
        );
      }
    }
    return yield* run({ loader });
  });
