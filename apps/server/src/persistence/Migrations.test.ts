import MessageAttribution from "./Migrations/004_MessageAttribution";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";

import Baseline from "./Migrations/001_Baseline.ts";
import { migrationEntries, runMigrations } from "./Migrations.ts";
import { MigrationLineageUnsupportedError, MigrationSchemaTooNewError } from "./Errors.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

describe("baseline migrations", () => {
  it.effect("creates a fresh database and applies migrations after the baseline", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migrator.make({})({ loader: Migrator.fromRecord({ "001_Baseline": Baseline }) });
      yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('new-project', 'Fresh project', '/workspace', '[]', '2026-09-30', '2026-09-30')
      `;
      yield* runMigrations();
      assert.deepStrictEqual(yield* runMigrations(), []);
      const projects = yield* sql<{
        readonly title: string;
      }>`SELECT title FROM projection_projects`;
      assert.strictEqual(projects[0]?.title, "Fresh project");
      const futureMigration = sql`ALTER TABLE projection_projects ADD COLUMN description TEXT`;
      const nextId = Math.max(...migrationEntries.map(([id]) => id)) + 1;
      const loader = Migrator.fromRecord(
        Object.fromEntries([
          ...migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
          [`${nextId}_ProjectDescriptions`, futureMigration],
        ]),
      );
      const migrate = Migrator.make({});
      assert.deepStrictEqual(yield* migrate({ loader }), [[nextId, "ProjectDescriptions"]]);
      yield* sql`UPDATE projection_projects SET description = 'After baseline' WHERE project_id = 'new-project'`;
      assert.deepStrictEqual(yield* migrate({ loader }), []);
      const updated = yield* sql<{ readonly title: string; readonly description: string }>`
        SELECT title, description FROM projection_projects
      `;
      assert.deepStrictEqual(updated, [{ title: "Fresh project", description: "After baseline" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("refuses a preview database without altering it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY, name TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (1, 'OrchestrationEvents'), (112, 'ConvertStudioProjects')
      `;
      const error = yield* Effect.flip(runMigrations());
      assert.instanceOf(error, MigrationLineageUnsupportedError);
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_projects'
      `;
      assert.deepStrictEqual(tables, []);
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
  it.effect(
    "backfills message attribution from original journal boundaries and preserves imported unknowns and user content",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: Migrator.fromRecord({ "001_Baseline": Baseline }) });
        for (const [sequence, type, payload] of [
          [1, "thread.created", { modelSelection: { provider: "codex", model: "original-model" } }],
          [2, "thread.message-sent", { messageId: "before" }],
          [
            3,
            "thread.meta-updated",
            { modelSelection: { provider: "claudeAgent", model: "destination-model" } },
          ],
          [4, "thread.message-sent", { messageId: "after" }],
        ] as const)
          yield* sql`INSERT INTO orchestration_events (sequence, event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json) VALUES (${sequence}, ${String(sequence)}, 'thread', 'chat', ${sequence}, ${type}, '2026-10-04', 'server', ${JSON.stringify(payload)}, '{}')`;
        for (const [id, sequence, source] of [
          ["before", 2, "native"],
          ["after", 4, "native"],
          ["imported", 4, "handoff-import"],
        ] as const)
          yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, source, sequence, created_at, updated_at) VALUES (${id}, 'chat', 'assistant', 'Preserve this text', 0, ${source}, ${sequence}, '2026-10-04', '2026-10-04')`;
        yield* runMigrations();
        yield* MessageAttribution;
        const rows = yield* sql<{
          message_id: string;
          text: string;
          model_selection_json: string | null;
        }>`SELECT message_id, text, model_selection_json FROM projection_thread_messages ORDER BY message_id`;
        assert.deepStrictEqual(
          rows.map((row) => [
            row.message_id,
            row.model_selection_json ? JSON.parse(row.model_selection_json) : null,
          ]),
          [
            ["after", { provider: "claudeAgent", model: "destination-model" }],
            ["before", { provider: "codex", model: "original-model" }],
            ["imported", null],
          ],
        );
        assert.strictEqual(
          rows.every((row) => row.text === "Preserve this text"),
          true,
        );
      }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
