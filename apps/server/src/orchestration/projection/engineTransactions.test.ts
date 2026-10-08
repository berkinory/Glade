import { it, assert } from "@effect/vitest";
import { OrchestrationEngineLive } from "../Layers/OrchestrationEngine.ts";
import { Layer, Effect } from "effect";
import { OrchestrationProjectionPipelineLive } from "../Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerConfig } from "../../server/config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { CommandId, ProjectId, ThreadId, EventId } from "@glade/contracts/core/baseSchemas";

const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "glade-projection-pipeline-engine-dispatch-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

engineLayer("OrchestrationProjectionPipeline via engine dispatch", (it) => {
  it.effect("projects dispatched engine events immediately", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = new Date().toISOString();

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-live-project"),
        projectId: ProjectId.makeUnsafe("project-live"),
        title: "Live Project",
        workspaceRoot: "/tmp/project-live",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      });

      const projectRows = yield* sql<{ readonly title: string; readonly scriptsJson: string }>`
        SELECT
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
        WHERE project_id = 'project-live'
      `;
      assert.deepEqual(projectRows, [{ title: "Live Project", scriptsJson: "[]" }]);

      const projectorRows = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = 'projection.projects'
      `;
      assert.deepEqual(projectorRows, [{ lastAppliedSequence: 1 }]);

      const snapshotProjectorRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector IN (
          'projection.projects',
          'projection.threads',
          'projection.thread-messages',
          'projection.thread-activities',
          'projection.thread-sessions',
          'projection.checkpoints'
        )
        ORDER BY projector ASC
      `;
      assert.deepEqual(snapshotProjectorRows, [
        { projector: "projection.checkpoints", lastAppliedSequence: 1 },
        { projector: "projection.projects", lastAppliedSequence: 1 },
        { projector: "projection.thread-activities", lastAppliedSequence: 1 },
        { projector: "projection.thread-messages", lastAppliedSequence: 1 },
        { projector: "projection.thread-sessions", lastAppliedSequence: 1 },
        { projector: "projection.threads", lastAppliedSequence: 1 },
      ]);
    }),
  );

  it.effect("routes telemetry activities only through their owning hot projector", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-07-09T00:00:00.000Z";
      const projectId = ProjectId.makeUnsafe("project-routed-telemetry");
      const threadId = ThreadId.makeUnsafe("thread-routed-telemetry");

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-routed-project"),
        projectId,
        title: "Routed telemetry",
        workspaceRoot: "/tmp/project-routed-telemetry",
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-routed-thread"),
        threadId,
        projectId,
        title: "Routed telemetry",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      });

      yield* sql`CREATE TABLE projection_state_write_log (projector TEXT NOT NULL)`;
      yield* sql`
        CREATE TRIGGER log_projection_state_insert
        AFTER INSERT ON projection_state
        BEGIN
          INSERT INTO projection_state_write_log (projector) VALUES (NEW.projector);
        END
      `;
      yield* sql`
        CREATE TRIGGER log_projection_state_update
        AFTER UPDATE ON projection_state
        BEGIN
          INSERT INTO projection_state_write_log (projector) VALUES (NEW.projector);
        END
      `;

      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-routed-context-window"),
        threadId,
        activity: {
          id: EventId.makeUnsafe("activity-routed-context-window"),
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload: { usedTokens: 42, maxTokens: 200_000 },
          turnId: null,
          createdAt,
        },
        createdAt,
      });

      const writes = yield* sql<{ readonly projector: string }>`
        SELECT projector
        FROM projection_state_write_log
        ORDER BY projector ASC
      `;
      assert.deepEqual(writes, [
        { projector: "projection.hot" },
        { projector: "projection.thread-activities" },
        { projector: "projection.thread-shell-summaries" },
      ]);
    }),
  );
});
