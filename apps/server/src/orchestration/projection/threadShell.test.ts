import { Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { assert } from "@effect/vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { projectionSnapshotLayer, asProjectId, asTurnId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot threadShell", (it) => {
  it.effect("hydrates shell reads from stored thread summary columns", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

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
          'project-shell',
          'Shell Project',
          '/tmp/project-shell',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-03-03T00:00:00.000Z',
          '2026-03-03T00:00:01.000Z',
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
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        ) VALUES (
          'thread-shell',
          'project-shell',
          'Shell Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'local',
          NULL,
          NULL,
          'turn-shell',
          NULL,
          '2026-03-03T00:00:02.500Z',
          2,
          1,
          '2026-03-03T00:00:02.000Z',
          '2026-03-03T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-shell',
          'ready',
          'codex',
          'provider-session-shell',
          'provider-thread-shell',
          'full-access',
          NULL,
          NULL,
          '2026-03-03T00:00:04.000Z'
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
        ) VALUES (
          'thread-shell',
          'turn-shell',
          NULL,
          NULL,
          'completed',
          '2026-03-03T00:00:05.000Z',
          '2026-03-03T00:00:05.000Z',
          '2026-03-03T00:00:05.000Z',
          NULL,
          NULL,
          NULL,
          '[]'
        )
      `;

      let sequence = 20;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-03-03T00:00:06.000Z'
          )
        `;
        sequence += 1;
      }

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(shellSnapshot.threads, [
        {
          id: ThreadId.makeUnsafe("thread-shell"),
          projectId: asProjectId("project-shell"),
          title: "Shell Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: null,
          associatedWorktreePath: null,
          associatedWorktreeBranch: null,
          associatedWorktreeRef: null,
          createBranchFlowCompleted: false,
          isPinned: false,
          parentThreadId: null,
          creationSource: null,
          sourceThreadId: null,
          sourceTurnId: null,
          gatewayOperationId: null,
          gatewayOperationIndex: null,
          subagentAgentId: null,
          subagentNickname: null,
          subagentRole: null,
          forkSourceThreadId: null,
          lastKnownPr: null,
          latestTurn: {
            turnId: asTurnId("turn-shell"),
            state: "completed",
            requestedAt: "2026-03-03T00:00:05.000Z",
            startedAt: "2026-03-03T00:00:05.000Z",
            completedAt: "2026-03-03T00:00:05.000Z",
            assistantMessageId: null,
          },
          latestUserMessageAt: "2026-03-03T00:00:02.500Z",
          latestHumanMessageAt: null,
          backgroundWork: { taskIds: [], awaitingReplyTaskIds: [], failed: false, settledAt: null },
          hasPendingApprovals: true,
          hasPendingUserInput: true,
          createdAt: "2026-03-03T00:00:02.000Z",
          updatedAt: "2026-03-03T00:00:03.000Z",
          archivedAt: null,
          settledAt: null,
          handoff: null,
          session: {
            threadId: ThreadId.makeUnsafe("thread-shell"),
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-03-03T00:00:04.000Z",
          },
        },
      ]);

      const threadShell = yield* snapshotQuery.getThreadShellById(
        ThreadId.makeUnsafe("thread-shell"),
      );
      assert.equal(threadShell._tag, "Some");
      if (threadShell._tag === "Some") {
        assert.deepEqual(threadShell.value, shellSnapshot.threads[0]);
      }
    }),
  );

  it.effect("reads background work from the latest turn and the task rows after its request", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at
        ) VALUES (
          'project-bg', 'Project', '/tmp/project-bg', '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-03-03T00:00:00.000Z', '2026-03-03T00:00:00.000Z'
        )
      `;
      for (const threadId of ["thread-bg", "thread-bg-old"]) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, env_mode,
            pending_approval_count, pending_user_input_count, created_at, updated_at
          ) VALUES (
            ${threadId}, 'project-bg', 'Thread', '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access', 'local', 0, 0, '2026-03-03T00:00:00.000Z', '2026-03-03T00:00:00.000Z'
          )
        `;
      }
      const turns = [
        ["thread-bg", "turn-1", "2026-03-03T00:01:00.000Z"],
        ["thread-bg", "turn-2", "2026-03-03T00:02:00.000Z"],
        // A requested follow-up has no turn id yet and must not replace the running turn.
        ["thread-bg", null, "2026-03-03T00:03:00.000Z"],
        ["thread-bg-old", "turn-old-1", "2026-03-03T00:01:00.000Z"],
        ["thread-bg-old", "turn-old-2", "2026-03-03T00:02:00.000Z"],
      ] as const;
      for (const [threadId, turnId, requestedAt] of turns) {
        yield* sql`
          INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, checkpoint_files_json)
          VALUES (${threadId}, ${turnId}, 'running', ${requestedAt}, '[]')
        `;
      }
      const activities = [
        ["thread-bg", "turn-1", "task.started", "old", "2026-03-03T00:01:10.000Z"],
        ["thread-bg", "turn-2", "task.started", "bg-a", "2026-03-03T00:02:10.000Z"],
        ["thread-bg", "turn-2", "task.started", "bg-b", "2026-03-03T00:02:20.000Z"],
        ["thread-bg", null, "task.completed", "bg-a", "2026-03-03T00:03:30.000Z"],
        ["thread-bg-old", "turn-old-1", "task.started", "stale", "2026-03-03T00:01:10.000Z"],
        ["thread-bg-old", null, "task.progress", "stale", "2026-03-03T00:01:30.000Z"],
      ] as const;
      for (const [index, [threadId, turnId, kind, taskId, createdAt]] of activities.entries()) {
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence
          ) VALUES (
            ${`activity-${index}`}, ${threadId}, ${turnId}, 'info', ${kind}, 'Task',
            ${JSON.stringify({ taskId, isBackgrounded: true })}, ${createdAt}, ${index}
          )
        `;
      }

      const shell = yield* snapshotQuery.getThreadShellById(ThreadId.makeUnsafe("thread-bg"));
      assert.deepEqual(Option.getOrThrow(shell).backgroundWork, {
        taskIds: ["bg-b"],
        awaitingReplyTaskIds: [],
        failed: false,
        settledAt: "2026-03-03T00:03:30.000Z",
      });
      const withPossibleWork = yield* snapshotQuery.listThreadShellsWithPossibleWork();
      assert.deepEqual(
        withPossibleWork.map((thread) => ({
          id: thread.id,
          taskIds: thread.backgroundWork?.taskIds,
        })),
        [{ id: ThreadId.makeUnsafe("thread-bg"), taskIds: ["bg-b"] }],
      );
    }),
  );
});
