import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";

import { migrationEntries, runMigrations } from "./Migrations.ts";
import { MigrationSchemaTooNewError } from "./Errors.ts";
import Baseline from "./Migrations/112_Baseline.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

describe("baseline migrations", () => {
  it.effect("creates a fresh database and applies migrations after the baseline", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed, [[112, "Baseline"]]);
      yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('new-project', 'Fresh project', '/workspace', '[]', '2026-09-30', '2026-09-30')
      `;
      assert.deepStrictEqual(yield* runMigrations(), []);
      const projects = yield* sql<{
        readonly title: string;
      }>`SELECT title FROM projection_projects`;
      assert.strictEqual(projects[0]?.title, "Fresh project");
      const futureMigration = sql`ALTER TABLE projection_projects ADD COLUMN description TEXT`;
      const loader = Migrator.fromRecord(
        Object.fromEntries([
          ...migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
          ["113_ProjectDescriptions", futureMigration],
        ]),
      );
      const migrate = Migrator.make({});
      assert.deepStrictEqual(yield* migrate({ loader }), [[113, "ProjectDescriptions"]]);
      yield* sql`UPDATE projection_projects SET description = 'After baseline' WHERE project_id = 'new-project'`;
      assert.deepStrictEqual(yield* migrate({ loader }), []);
      const updated = yield* sql<{ readonly title: string; readonly description: string }>`
        SELECT title, description FROM projection_projects
      `;
      assert.deepStrictEqual(updated, [{ title: "Fresh project", description: "After baseline" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("skips the baseline for an existing tracker and preserves data and tracker names", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Baseline;
      yield* sql`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY, name TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (112, 'ConvertStudioProjects')`;
      yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('existing-project', 'Keep me', '/workspace', '[]', '2026-09-30', '2026-09-30')
      `;
      yield* sql`CREATE TABLE retired_provider_runtime_events (payload TEXT)`;
      yield* sql`INSERT INTO retired_provider_runtime_events VALUES ('archived user data')`;
      assert.deepStrictEqual(yield* runMigrations(), []);
      const projects = yield* sql<{
        readonly title: string;
      }>`SELECT title FROM projection_projects`;
      assert.strictEqual(projects[0]?.title, "Keep me");
      const tracker = yield* sql<{
        readonly name: string;
      }>`SELECT name FROM effect_sql_migrations WHERE migration_id = 112`;
      assert.strictEqual(tracker[0]?.name, "ConvertStudioProjects");
      const archived = yield* sql<{
        readonly payload: string;
      }>`SELECT payload FROM retired_provider_runtime_events`;
      assert.strictEqual(archived[0]?.payload, "archived user data");
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("refuses a newer database without altering its tracker", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (999, 'Future')`;
      const error = yield* Effect.flip(runMigrations());
      assert.instanceOf(error, MigrationSchemaTooNewError);
      const rows = yield* sql<{
        readonly id: number;
      }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
      assert.strictEqual(rows[0]?.id, 999);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
