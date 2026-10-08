import MessageAttribution from "./Migrations/004_MessageAttribution";
import VisualReplyAttachments from "./Migrations/006_VisualReplyAttachments";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";

import Baseline from "./Migrations/001_Baseline.ts";
import { runMigrations } from "./Migrations.ts";
import { MigrationLineageUnsupportedError, MigrationSchemaTooNewError } from "./Errors.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

describe("baseline migrations", () => {
  it.effect("adds visual reply ownership without changing existing attachment rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Baseline;
      yield* sql`INSERT INTO managed_attachment_blobs (
        attachment_id, owner_thread_id, owner_kind, owner_id, kind, original_name,
        mime_type, reserved_bytes, size_bytes, sha256, relative_path, state, claim_command_id, claim_message_id, claimed_at, created_at, updated_at
      ) VALUES ('existing', 'thread', 'session', 'owner', 'file', 'kept.txt',
        'text/plain', 4, 4, ${"a".repeat(64)}, 'objects/kept.txt', 'claimed', 'cmd', 'msg', '2026-10-01', '2026-10-01', '2026-10-01')`;
      yield* VisualReplyAttachments;
      yield* VisualReplyAttachments;
      assert.deepStrictEqual(
        yield* sql`SELECT attachment_id, original_name, size_bytes, state, purpose FROM managed_attachment_blobs`,
        [
          {
            attachment_id: "existing",
            original_name: "kept.txt",
            size_bytes: 4,
            state: "claimed",
            purpose: null,
          },
        ],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

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
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
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
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
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
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
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
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
