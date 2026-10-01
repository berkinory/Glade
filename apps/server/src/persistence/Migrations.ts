import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { MigrationLineageUnsupportedError, MigrationSchemaTooNewError } from "./Errors.ts";
import Baseline from "./Migrations/001_Baseline.ts";

export const migrationEntries = [[1, "Baseline", Baseline]] as const;

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
      const rows = yield* sql<{ readonly id: number | null; readonly baseline: number }>`
        SELECT
          MAX(migration_id) AS id,
          COUNT(*) FILTER (WHERE migration_id = 1 AND name = 'Baseline') AS baseline
        FROM effect_sql_migrations
      `;
      const id = rows[0]?.id ?? 0;
      // Preview builds (0.0.x) recorded a different migration lineage that this schema cannot extend.
      if (id > 0 && rows[0]?.baseline === 0) {
        return yield* Effect.fail(
          new MigrationLineageUnsupportedError({ databaseMigrationId: id }),
        );
      }
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
