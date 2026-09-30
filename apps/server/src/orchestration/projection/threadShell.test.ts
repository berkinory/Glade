import { Effect } from "effect";
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
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
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
          interaction_mode,
          env_mode,
          branch,
          worktree_path,
          latest_turn_id,
          handoff_json,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-shell',
          'project-shell',
          'Shell Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          'local',
          NULL,
          NULL,
          'turn-shell',
          NULL,
          '2026-03-03T00:00:02.500Z',
          2,
          1,
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
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-shell',
          'turn-shell',
          NULL,
          NULL,
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
          interactionMode: "default",
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
          hasPendingApprovals: true,
          hasPendingUserInput: true,
          hasActionableProposedPlan: true,
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
});
