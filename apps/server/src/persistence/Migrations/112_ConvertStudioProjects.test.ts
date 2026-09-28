import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("Studio project conversion", (it) => {
  it.effect("keeps the folder and its threads readable after the kind is retired", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 111 });

      yield* sql`
        INSERT INTO projection_projects
          (project_id, kind, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES
          ('former-studio', 'studio', 'Studio', '/tmp/studio-folder', '[]', '2026-01-01', '2026-01-01'),
          ('ordinary', 'project', 'Ordinary', '/tmp/ordinary', '[]', '2026-01-01', '2026-01-01')
      `;
      yield* sql`
        INSERT INTO projection_threads
          (thread_id, project_id, title, created_at, updated_at)
        VALUES ('kept-thread', 'former-studio', 'Kept chat', '2026-01-01', '2026-01-01')
      `;
      yield* sql`
        INSERT INTO orchestration_events
          (event_id, aggregate_kind, stream_id, stream_version, event_type,
           occurred_at, actor_kind, payload_json, metadata_json)
        VALUES
          ('created', 'project', 'former-studio', 1, 'project.created',
           '2026-01-01', 'user', '{"kind":"studio","title":"Studio"}', '{}'),
          ('updated', 'project', 'former-studio', 2, 'project.meta-updated',
           '2026-01-01', 'user', '{"kind":"studio","title":"Renamed"}', '{}'),
          ('ordinary-created', 'project', 'ordinary', 1, 'project.created',
           '2026-01-01', 'user', '{"kind":"project","title":"Ordinary"}', '{}')
      `;

      yield* runMigrations();

      const projects = yield* sql<{
        project_id: string;
        kind: string;
        workspace_root: string;
      }>`SELECT project_id, kind, workspace_root FROM projection_projects ORDER BY project_id`;
      assert.deepStrictEqual(projects, [
        { project_id: "former-studio", kind: "project", workspace_root: "/tmp/studio-folder" },
        { project_id: "ordinary", kind: "project", workspace_root: "/tmp/ordinary" },
      ]);
      const threads = yield* sql<{ thread_id: string; project_id: string }>`
        SELECT thread_id, project_id FROM projection_threads
      `;
      assert.deepStrictEqual(threads, [{ thread_id: "kept-thread", project_id: "former-studio" }]);
      const events = yield* sql<{ event_id: string; kind: string; title: string }>`
        SELECT event_id,
          json_extract(payload_json, '$.kind') AS kind,
          json_extract(payload_json, '$.title') AS title
        FROM orchestration_events ORDER BY sequence
      `;
      assert.deepStrictEqual(events, [
        { event_id: "created", kind: "project", title: "Studio" },
        { event_id: "updated", kind: "project", title: "Renamed" },
        { event_id: "ordinary-created", kind: "project", title: "Ordinary" },
      ]);
    }),
  );
});
