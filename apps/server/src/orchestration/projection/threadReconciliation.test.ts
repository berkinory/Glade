import { Effect } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { projectionSnapshotLayer, asThreadId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot threadReconciliation", (it) => {
  it.effect("lists only stale active thread ids for reconciliation, oldest first", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-runtime-candidates', 'Runtime candidates', '/tmp/runtime-candidates',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES
          (
            'thread-stale-running', 'project-runtime-candidates', 'Stale',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z', NULL, NULL
          ),
          (
            'thread-fresh-running', 'project-runtime-candidates', 'Fresh',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-23T00:00:00.000Z', '2026-07-23T09:59:00.000Z', NULL, NULL
          ),
          (
            'thread-settled', 'project-runtime-candidates', 'Settled',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z', NULL, NULL
          ),
          (
            'thread-archived-running', 'project-runtime-candidates', 'Archived',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z',
            '2026-07-23T08:00:00.000Z', NULL
          ),
          (
            'thread-unbound-oldest', 'project-runtime-candidates', 'Unbound',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
            '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', NULL, NULL
          ),
          (
            'thread-queued-oldest', 'project-runtime-candidates', 'Queued',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, 'turn-queued',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL, NULL
          )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
          started_at, completed_at, checkpoint_turn_count, checkpoint_ref,
          checkpoint_status, checkpoint_files_json
        ) VALUES (
          'thread-queued-oldest', 'turn-queued', NULL, NULL, 'pending', '2026-07-21T00:00:00.000Z',
          NULL, NULL, 0, NULL, 'missing', '[]'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id, status, provider_name, provider_session_id, provider_thread_id,
          runtime_mode, active_turn_id, last_error, updated_at
        ) VALUES
          (
            'thread-stale-running', 'running', 'codex', NULL, NULL,
            'full-access', 'turn-stale', NULL, '2026-07-23T00:00:00.000Z'
          ),
          (
            'thread-fresh-running', 'running', 'codex', NULL, NULL,
            'full-access', 'turn-fresh', NULL, '2026-07-23T09:59:00.000Z'
          ),
          (
            'thread-settled', 'ready', 'codex', NULL, NULL,
            'full-access', NULL, NULL, '2026-07-23T00:00:00.000Z'
          ),
          (
            'thread-archived-running', 'running', 'codex', NULL, NULL,
            'full-access', 'turn-archived', NULL, '2026-07-23T00:00:00.000Z'
          ),
          (
            'thread-unbound-oldest', 'running', 'codex', NULL, NULL,
            'full-access', 'turn-unbound', NULL, '2026-07-22T00:00:00.000Z'
          ),
          (
            'thread-queued-oldest', 'starting', 'codex', NULL, NULL,
            'full-access', NULL, NULL, '2026-07-21T00:00:00.000Z'
          )
      `;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, adapter_key, runtime_mode, status,
          lifecycle_generation, last_seen_at, runtime_payload_json
        ) VALUES
          (
            'thread-stale-running', 'codex', 'codex', 'full-access', 'running',
            'generation-stale', '2026-07-23T00:00:00.000Z', NULL
          ),
          (
            'thread-fresh-running', 'codex', 'codex', 'full-access', 'running',
            'generation-fresh', '2026-07-23T09:59:00.000Z', NULL
          ),
          (
            'thread-queued-oldest', 'codex', 'codex', 'full-access', 'starting',
            'generation-queued', '2026-07-21T00:00:00.000Z', '{}'
          )
        ON CONFLICT (thread_id) DO UPDATE SET
          provider_name = excluded.provider_name,
          adapter_key = excluded.adapter_key,
          runtime_mode = excluded.runtime_mode,
          status = excluded.status,
          lifecycle_generation = excluded.lifecycle_generation,
          last_seen_at = excluded.last_seen_at,
          runtime_payload_json = excluded.runtime_payload_json
      `;

      const candidates = yield* snapshotQuery.listStaleInFlightThreadIds({
        updatedBefore: "2026-07-23T09:00:00.000Z",
        limit: 10,
      });

      assert.deepEqual(candidates, [
        ThreadId.makeUnsafe("thread-unbound-oldest"),
        ThreadId.makeUnsafe("thread-archived-running"),
        ThreadId.makeUnsafe("thread-stale-running"),
      ]);

      const oldestCandidate = yield* snapshotQuery.listStaleInFlightThreadIds({
        updatedBefore: "2026-07-23T09:00:00.000Z",
        limit: 1,
      });
      assert.deepEqual(oldestCandidate, [ThreadId.makeUnsafe("thread-unbound-oldest")]);
    }),
  );

  it.effect("lists managed worktree threads including soft-deleted owners", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-worktrees', 'Worktrees', '/tmp/worktrees',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          associated_worktree_path, latest_turn_id, created_at, updated_at,
          archived_at, deleted_at
        ) VALUES
          (
            'thread-worktree-active', 'project-worktrees', 'Active',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, '/tmp/wt/active',
            NULL, NULL, '2026-07-24T00:00:01.000Z', '2026-07-24T00:00:01.000Z',
            NULL, NULL
          ),
          (
            'thread-worktree-deleted', 'project-worktrees', 'Retention deleted',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, '/tmp/wt/deleted',
            '/tmp/wt/deleted-assoc', NULL, '2026-07-24T00:00:02.000Z',
            '2026-07-24T00:00:09.000Z', '2026-07-24T00:00:08.000Z',
            '2026-07-24T00:00:09.000Z'
          ),
          (
            'thread-no-worktree', 'project-worktrees', 'No worktree',
            '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL,
            NULL, NULL, '2026-07-24T00:00:03.000Z', '2026-07-24T00:00:03.000Z',
            NULL, NULL
          )
      `;

      const threads = yield* snapshotQuery.listManagedWorktreeThreads();
      assert.deepEqual(threads, [
        {
          id: asThreadId("thread-worktree-active"),
          archivedAt: null,
          deletedAt: null,
          worktreePath: "/tmp/wt/active",
          associatedWorktreePath: null,
        },
        {
          id: asThreadId("thread-worktree-deleted"),
          archivedAt: "2026-07-24T00:00:08.000Z",
          deletedAt: "2026-07-24T00:00:09.000Z",
          worktreePath: "/tmp/wt/deleted",
          associatedWorktreePath: "/tmp/wt/deleted-assoc",
        },
      ]);
    }),
  );
});
