import { Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { projectionSnapshotLayer, asThreadId, asMessageId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot commandHistory", (it) => {
  it.effect("uses a settlement row when mixed activity counters replay a stale approval", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = asThreadId("thread-mixed-approval-sequence");

      yield* sql`DELETE FROM projection_pending_interactions`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-mixed-approval-sequence', 'Mixed approval sequence',
          '/tmp/project-mixed-approval-sequence',
          '{"provider":"claudeAgent","model":"claude-sonnet-5"}', '[]',
          '2026-09-09T22:00:00.000Z', '2026-09-09T22:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-mixed-approval-sequence', 'project-mixed-approval-sequence',
          'Mixed approval sequence',
          '{"provider":"claudeAgent","model":"claude-sonnet-5"}',
          NULL, NULL, NULL,
          '2026-09-09T22:00:00.000Z', '2026-09-09T22:02:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json,
          sequence, created_at
        ) VALUES
          (
            'activity-approval-requested-high', 'thread-mixed-approval-sequence', NULL,
            'approval', 'approval.requested', 'Command approval requested',
            '{"requestId":"approval-mixed","requestKind":"command"}',
            1695339, '2026-09-09T22:01:00.000Z'
          ),
          (
            'activity-approval-stale-low', 'thread-mixed-approval-sequence', NULL,
            'error', 'provider.approval.respond.failed', 'Provider approval response failed',
            '{"requestId":"approval-mixed","detail":"Stale pending approval request: approval-mixed. Provider callback state does not survive app restarts."}',
            667085, '2026-09-09T22:02:00.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_pending_interactions (
          interaction_kind, request_id, thread_id, turn_id, lifecycle_generation, status,
          decision, response_command_id, response_requested_at, created_at, resolved_at
        ) VALUES (
          'approval', 'approval-mixed', 'thread-mixed-approval-sequence', NULL,
          NULL, 'uncertain', NULL, 'restart-reconcile-command', NULL,
          '2026-09-09T22:01:00.000Z', '2026-09-09T22:02:00.000Z'
        )
      `;

      const detail = yield* snapshotQuery.getThreadDetailById(threadId);

      assert.isTrue(Option.isSome(detail));
      if (Option.isSome(detail)) {
        assert.isFalse(detail.value.hasPendingApprovals ?? true);
        assert.equal(detail.value.pendingInteractions?.[0]?.status, "uncertain");
      }
    }),
  );

  it.effect("keeps the latest checkpoint-revert lifecycle row in the command model", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-revert-lifecycle', 'Revert lifecycle', '/tmp/revert-lifecycle',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-revert-lifecycle', 'project-revert-lifecycle', 'Revert lifecycle',
          '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        ) VALUES (
          'revert-started', 'thread-revert-lifecycle', NULL, 'info',
          'checkpoint.revert.started', 'Checkpoint revert started', '{}', 10,
          '2026-07-21T00:00:01.000Z'
        )
      `;

      const startedModel = yield* snapshotQuery.getCommandReadModel();
      assert.deepEqual(
        startedModel.threads[0]?.activities.map((activity) => activity.kind),
        ["checkpoint.revert.started"],
      );

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        ) VALUES (
          'revert-succeeded', 'thread-revert-lifecycle', NULL, 'info',
          'checkpoint.revert.succeeded', 'Checkpoint revert completed', '{}', 11,
          '2026-07-21T00:00:02.000Z'
        )
      `;

      const completedModel = yield* snapshotQuery.getCommandReadModel();
      assert.deepEqual(
        completedModel.threads[0]?.activities.map((activity) => activity.kind),
        ["checkpoint.revert.succeeded"],
      );
    }),
  );

  it.effect("excludes soft-deleted thread bodies from the full snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-soft-delete', 'Soft delete', '/tmp/soft-delete',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES
          (
            'thread-live', 'project-soft-delete', 'Live',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-24T00:00:01.000Z', '2026-07-24T00:00:01.000Z', NULL
          ),
          (
            'thread-soft-deleted', 'project-soft-delete', 'Retention deleted',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-24T00:00:02.000Z', '2026-07-24T00:00:09.000Z',
            '2026-07-24T00:00:09.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        ) VALUES
          (
            'message-live', 'thread-live', NULL, 'user', 'visible', 0,
            '2026-07-24T00:00:03.000Z', '2026-07-24T00:00:03.000Z'
          ),
          (
            'message-deleted', 'thread-soft-deleted', NULL, 'user', 'hidden', 0,
            '2026-07-24T00:00:04.000Z', '2026-07-24T00:00:04.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        ) VALUES
          (
            'activity-live', 'thread-live', NULL, 'info', 'runtime.note',
            'visible', '{}', 1, '2026-07-24T00:00:05.000Z'
          ),
          (
            'activity-deleted', 'thread-soft-deleted', NULL, 'info', 'runtime.note',
            'hidden', '{}', 2, '2026-07-24T00:00:06.000Z'
          )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();

      const live = snapshot.threads.find((thread) => thread.id === asThreadId("thread-live"));
      const deleted = snapshot.threads.find(
        (thread) => thread.id === asThreadId("thread-soft-deleted"),
      );
      assert.deepEqual(
        live?.messages.map((message) => message.id),
        [asMessageId("message-live")],
      );
      assert.deepEqual(
        live?.activities.map((activity) => activity.summary),
        ["visible"],
      );
      assert.isDefined(deleted);
      assert.deepEqual(deleted?.messages, []);
      assert.deepEqual(deleted?.activities, []);
    }),
  );

  it.effect("keeps soft-deleted thread activities visible to the command read model", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-deleted-command', 'Deleted command', '/tmp/deleted-command',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-deleted-command', 'project-deleted-command', 'Deleted command',
          '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
          '2026-07-24T00:00:01.000Z', '2026-07-24T00:00:09.000Z',
          '2026-07-24T00:00:09.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        ) VALUES (
          'revert-started-deleted', 'thread-deleted-command', NULL, 'info',
          'checkpoint.revert.started', 'Checkpoint revert started', '{}', 10,
          '2026-07-24T00:00:02.000Z'
        )
      `;

      const commandModel = yield* snapshotQuery.getCommandReadModel();
      const thread = commandModel.threads.find(
        (candidate) => candidate.id === asThreadId("thread-deleted-command"),
      );
      assert.deepEqual(
        thread?.activities.map((activity) => activity.kind),
        ["checkpoint.revert.started"],
      );
    }),
  );
});
