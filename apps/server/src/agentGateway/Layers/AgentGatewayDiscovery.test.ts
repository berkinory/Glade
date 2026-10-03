import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { AgentGatewayDiscovery } from "../Services/AgentGatewayDiscovery";
import { AgentGatewayDiscoveryLive } from "./AgentGatewayDiscovery";

const layer = it.layer(
  AgentGatewayDiscoveryLive.pipe(
    Layer.provideMerge(
      OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ),
  ),
);

layer("Agent gateway persisted discovery", (it) => {
  it.effect("pages tied timestamps without losing threads and rejects changed cursor filters", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const discovery = yield* AgentGatewayDiscovery;
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('p', 'Project', '/tmp/project', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
      for (let index = 0; index < 25; index++) {
        yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, env_mode, created_at, updated_at)
        VALUES (${"t-" + index.toString().padStart(2, "0")}, 'p', 'Thread', '{"provider":"codex","model":"test"}', 'full-access', 'local', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
      }
      const first = yield* discovery.listThreads({});
      assert.equal(first.threads.length, 20);
      assert.isNotNull(first.nextCursor);
      const second = yield* discovery.listThreads({ cursor: first.nextCursor! });
      assert.equal(second.threads.length, 5);
      assert.isNull(second.nextCursor);
      assert.equal(
        new Set([...first.threads, ...second.threads].map((thread) => thread.id)).size,
        25,
      );
      const changed = yield* discovery
        .listThreads({ cursor: first.nextCursor!, includeArchived: true })
        .pipe(Effect.flip);
      assert.include(changed.message, "filters changed");
      const filtered = yield* discovery.listThreads({ model: "missing" });
      assert.equal(filtered.threads.length, 0);
      assert.equal((yield* discovery.listProjects).length, 1);
    }),
  );
});
