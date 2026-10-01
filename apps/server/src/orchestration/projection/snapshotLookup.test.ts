import { Effect } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import {
  projectionSnapshotLayer,
  asProjectId,
  asTurnId,
  asCheckpointRef,
} from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot snapshotLookup", (it) => {
  it.effect("reads aggregate counts and cheap lookups without hydrating the full snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-active',
            'Active Project',
            '/tmp/workspace',
            NULL,
            '[]',
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:01.000Z',
            NULL
          ),
          (
            'project-deleted',
            'Deleted Project',
            '/tmp/deleted',
            NULL,
            '[]',
            '2026-03-01T00:00:02.000Z',
            '2026-03-01T00:00:03.000Z',
            '2026-03-01T00:00:04.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          env_mode,
          branch,
          worktree_path,
          latest_turn_id,
          handoff_json,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        ) VALUES
          (
            'thread-first',
            'project-active',
            'First Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'local',
            NULL,
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:05.000Z',
            '2026-03-01T00:00:06.000Z',
            NULL,
            NULL
          ),
          (
            'thread-second',
            'project-active',
            'Second Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'local',
            NULL,
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:07.000Z',
            '2026-03-01T00:00:08.000Z',
            NULL,
            NULL
          ),
          (
            'thread-deleted',
            'project-active',
            'Deleted Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'local',
            NULL,
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:09.000Z',
            '2026-03-01T00:00:10.000Z',
            NULL,
            '2026-03-01T00:00:11.000Z'
          )
      `;

      const counts = yield* snapshotQuery.getCounts();
      assert.deepEqual(counts, {
        projectCount: 2,
        threadCount: 3,
      });

      const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/workspace");
      assert.equal(project._tag, "Some");
      if (project._tag === "Some") {
        assert.equal(project.value.id, asProjectId("project-active"));
      }

      const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/missing");
      assert.equal(missingProject._tag, "None");

      const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
        asProjectId("project-active"),
      );
      assert.equal(firstThreadId._tag, "Some");
      if (firstThreadId._tag === "Some") {
        assert.equal(firstThreadId.value, ThreadId.makeUnsafe("thread-first"));
      }
    }),
  );

  it.effect("reads single-thread checkpoint context without hydrating unrelated threads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_thread_activities`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-context',
          'Context Project',
          '/tmp/context-workspace',
          NULL,
          '[]',
          '2026-03-02T00:00:00.000Z',
          '2026-03-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          env_mode,
          branch,
          worktree_path,
          latest_turn_id,
          handoff_json,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        ) VALUES (
          'thread-context',
          'project-context',
          'Context Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'local',
          'feature/perf',
          '/tmp/context-worktree',
          NULL,
          NULL,
          '2026-03-02T00:00:02.000Z',
          '2026-03-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        ) VALUES
          (
            'thread-context',
            'turn-1',
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            1,
            'checkpoint-a',
            'ready',
            '[]'
          ),
          (
            'thread-context',
            'turn-placeholder',
            NULL,
            NULL,
            'running',
            '2026-03-02T00:00:04.500Z',
            '2026-03-02T00:00:04.500Z',
            NULL,
            3,
            'provider-diff:placeholder',
            'missing',
            '[]'
          ),
          (
            'thread-context',
            'turn-2',
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            2,
            'checkpoint-b',
            'ready',
            '[]'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at,
          sequence
        )
        VALUES
          (
            'activity-file-change',
            'thread-context',
            'turn-2',
            'tool',
            'tool.completed',
            'File change',
            '{"itemType":"file_change","status":"completed","data":{"path":"Outbox/Content/post.md"}}',
            '2026-03-02T00:00:05.100Z',
            1
          ),
          (
            'activity-command',
            'thread-context',
            'turn-2',
            'tool',
            'tool.completed',
            'Command',
            '{"itemType":"command_execution","status":"completed","data":{"path":"Outbox/ignored.md"}}',
            '2026-03-02T00:00:05.200Z',
            2
          ),
          (
            'activity-generated-image-tool',
            'thread-context',
            'turn-2',
            'tool',
            'tool.completed',
            'Generated image',
            '{"itemType":"image_generation","status":"completed","data":{"kind":"codex.generated_image","path":"/codex/generated.png"}}',
            '2026-03-02T00:00:05.500Z',
            3
          )
      `;

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.makeUnsafe("thread-context"),
      );
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          threadId: ThreadId.makeUnsafe("thread-context"),
          projectId: asProjectId("project-context"),
          projectKind: "project",
          workspaceRoot: "/tmp/context-workspace",
          envMode: "local",
          worktreePath: "/tmp/context-worktree",
          workingDirectory: null,
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-a"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:04.000Z",
            },
            {
              turnId: asTurnId("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: asCheckpointRef("checkpoint-b"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:05.000Z",
            },
          ],
        });
      }

      const generatedImageActivities = yield* snapshotQuery.listGeneratedImageActivitiesByTurn(
        ThreadId.makeUnsafe("thread-context"),
        TurnId.makeUnsafe("turn-2"),
      );
      assert.deepEqual(generatedImageActivities, [
        {
          kind: "tool.completed",
          payload: {
            itemType: "image_generation",
            status: "completed",
            data: { kind: "codex.generated_image", path: "/codex/generated.png" },
          },
        },
      ]);

      const fullThreadDiffContext = yield* snapshotQuery.getFullThreadDiffContext(
        ThreadId.makeUnsafe("thread-context"),
        2,
      );
      assert.equal(fullThreadDiffContext._tag, "Some");
      if (fullThreadDiffContext._tag === "Some") {
        assert.deepEqual(fullThreadDiffContext.value, {
          threadId: ThreadId.makeUnsafe("thread-context"),
          projectId: asProjectId("project-context"),
          projectKind: "project",
          workspaceRoot: "/tmp/context-workspace",
          envMode: "local",
          worktreePath: "/tmp/context-worktree",
          workingDirectory: null,
          latestCheckpointTurnCount: 2,
          baselineCheckpointRef: asCheckpointRef("checkpoint-a"),
          toCheckpointRef: asCheckpointRef("checkpoint-b"),
        });
      }
    }),
  );
});
