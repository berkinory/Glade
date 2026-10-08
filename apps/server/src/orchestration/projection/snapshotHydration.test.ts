import { Effect } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  projectionSnapshotLayer,
  asMessageId,
  asProjectId,
  asTurnId,
  asEventId,
  asCheckpointRef,
} from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot snapshotHydration", (it) => {
  it.effect(
    "selects the latest turn per thread with stable ties and preserves historical update time",
    () =>
      Effect.gen(function* () {
        const query = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_state`;
        yield* sql`DELETE FROM projection_turns`;
        yield* sql`DELETE FROM projection_thread_sessions`;
        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`DELETE FROM projection_thread_activities`;
        yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('latest-project', 'Latest', '/tmp/latest', '[]',
          '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')
      `;
        yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, latest_turn_id, created_at, updated_at
        ) VALUES
          ('latest-a', 'latest-project', 'A', '{"provider":"codex","model":"gpt-5.5"}',
            'turn-old', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
          ('latest-b', 'latest-project', 'B', '{"provider":"codex","model":"gpt-5.5"}',
            NULL, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')
      `;
        yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, state, requested_at, completed_at, checkpoint_files_json
        ) VALUES
          ('latest-a', 'turn-old', 'completed', '2026-09-10T00:00:01.000Z', '2026-09-10T00:00:09.000Z', '[]'),
          ('latest-a', 'turn-a', 'completed', '2026-09-10T00:00:02.000Z', NULL, '[]'),
          ('latest-a', 'turn-z', 'running', '2026-09-10T00:00:02.000Z', NULL, '[]'),
          ('latest-a', NULL, 'pending', '2026-09-10T00:00:10.000Z', NULL, '[]'),
          ('latest-b', 'turn-old', 'completed', '2026-09-10T00:00:03.000Z', NULL, '[]')
      `;
        for (const snapshot of [
          yield* query.getSnapshot(),
          yield* query.getShellSnapshot(),
          yield* query.getCommandReadModel(),
        ]) {
          assert.equal(
            snapshot.threads.find((thread) => thread.id === "latest-a")?.modelSelection.provider,
            "codex",
          );
          assert.equal(
            snapshot.threads.find((thread) => thread.id === "latest-a")?.latestTurn?.turnId,
            "turn-z",
          );
          assert.equal(
            snapshot.threads.find((thread) => thread.id === "latest-b")?.latestTurn?.turnId,
            "turn-old",
          );
          assert.equal(snapshot.updatedAt, "2026-09-10T00:00:09.000Z");
        }
      }),
  );

  it.effect("marks only an empty shell with an active durable project for repair", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM orchestration_events`;

      const firstRunSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.isFalse(firstRunSnapshot.requiresEmptyProjectShellRepair ?? false);

      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, payload_json, metadata_json
        ) VALUES (
          'event-empty-shell-project-created', 'project', 'project-empty-shell', 0,
          'project.created', '2026-08-11T00:00:00.000Z',
          'command-empty-shell-project-created', NULL, NULL, 'user', '{}', '{}'
        )
      `;

      const missingProjectionSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.isTrue(missingProjectionSnapshot.requiresEmptyProjectShellRepair ?? false);

      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, payload_json, metadata_json
        ) VALUES (
          'event-empty-shell-project-deleted', 'project', 'project-empty-shell', 1,
          'project.deleted', '2026-08-11T00:00:01.000Z',
          'command-empty-shell-project-deleted', NULL, NULL, 'user', '{}', '{}'
        )
      `;

      const deletedProjectSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.isFalse(deletedProjectSnapshot.requiresEmptyProjectShellRepair ?? false);

      yield* sql`DELETE FROM orchestration_events`;
    }),
  );

  it.effect("hydrates Space identity and project assignments in full and shell snapshots", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_spaces`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_spaces (
          space_id, name, icon, sort_order, created_at, updated_at, deleted_at
        ) VALUES (
          'space-snapshot', 'Snapshot Space', 'bag', 0,
          '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, space_id, created_at, updated_at, deleted_at
        ) VALUES (
          'project-space-snapshot', 'Space project', '/tmp/space-project', NULL,
          '[]', 'space-snapshot', '2026-07-20T00:00:00.000Z',
          '2026-07-20T00:00:01.000Z', NULL
        )
      `;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
          VALUES (${projector}, 7, '2026-07-20T00:00:01.000Z')
        `;
      }

      const shell = yield* snapshotQuery.getShellSnapshot();
      const full = yield* snapshotQuery.getSnapshot();
      assert.equal(shell.spaces[0]?.id, SpaceId.makeUnsafe("space-snapshot"));
      assert.equal(shell.projects[0]?.spaceId, SpaceId.makeUnsafe("space-snapshot"));
      assert.equal(full.spaces[0]?.id, SpaceId.makeUnsafe("space-snapshot"));
      assert.equal(full.projects[0]?.spaceId, SpaceId.makeUnsafe("space-snapshot"));

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_spaces`;
      yield* sql`DELETE FROM projection_state`;
    }),
  );

  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_turns`;

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
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          'turn-1',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES
          (
            'message-0',
            'thread-1',
            'turn-1',
            'user',
            'ship it',
            0,
            '2026-02-24T00:00:03.500Z',
            '2026-02-24T00:00:03.500Z'
          ),
          (
            'message-1',
            'thread-1',
            'turn-1',
            'assistant',
            'hello from projection',
            0,
            '2026-02-24T00:00:04.000Z',
            '2026-02-24T00:00:05.000Z'
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
          created_at
        )
        VALUES
          (
            'activity-1',
            'thread-1',
            'turn-1',
            'info',
            'runtime.note',
            'provider started',
            '{"stage":"start"}',
            '2026-02-24T00:00:06.000Z'
          ),
          (
            'activity-2',
            'thread-1',
            'turn-1',
            'approval',
            'approval.requested',
            'Command approval requested',
            '{"requestId":"approval-1","requestKind":"command"}',
            '2026-02-24T00:00:06.500Z'
          ),
          (
            'activity-3',
            'thread-1',
            'turn-1',
            'info',
            'user-input.requested',
            'User input requested',
            '{"requestId":"input-1","questions":[{"id":"q-1","header":"Mode","question":"Choose","options":[{"label":"A","description":"Pick A"}]}]}',
            '2026-02-24T00:00:06.750Z'
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
          'thread-1',
          'running',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'approval-required',
          'turn-1',
          NULL,
          '2026-02-24T00:00:07.000Z'
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
            'thread-1',
            'turn-1',
            NULL,
            'message-1',
            'completed',
            '2026-02-24T00:00:08.000Z',
            '2026-02-24T00:00:08.000Z',
            '2026-02-24T00:00:08.000Z',
            1,
            'checkpoint-1',
            'ready',
            '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
          ),
          (
            'thread-1',
            'turn-placeholder',
            NULL,
            NULL,
            'running',
            '2026-02-24T00:00:07.500Z',
            '2026-02-24T00:00:07.500Z',
            NULL,
            2,
            'provider-diff:placeholder',
            'missing',
            '[]'
          )
      `;

      let sequence = 5;
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
            '2026-02-24T00:00:09.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:09.000Z");
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          kind: "project",
          spaceId: null,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
          isPinned: false,
        },
      ]);
      assert.deepEqual(snapshot.threads, [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
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
          latestUserMessageAt: "2026-02-24T00:00:03.500Z",
          latestHumanMessageAt: null,
          // A present empty pending-interaction projection is authoritative; historical activity rows alone
          // must not resurrect stale prompts.
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          settledAt: null,
          deletedAt: null,
          handoff: null,
          messages: [
            {
              id: asMessageId("message-0"),
              role: "user",
              text: "ship it",
              turnId: asTurnId("turn-1"),
              streaming: false,
              source: "native",
              createdAt: "2026-02-24T00:00:03.500Z",
              updatedAt: "2026-02-24T00:00:03.500Z",
            },
            {
              id: asMessageId("message-1"),
              role: "assistant",
              text: "hello from projection",
              turnId: asTurnId("turn-1"),
              streaming: false,
              source: "native",
              createdAt: "2026-02-24T00:00:04.000Z",
              updatedAt: "2026-02-24T00:00:05.000Z",
            },
          ],
          activities: [
            {
              id: asEventId("activity-1"),
              tone: "info",
              kind: "runtime.note",
              summary: "provider started",
              payload: { stage: "start" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.000Z",
            },
            {
              id: asEventId("activity-2"),
              tone: "approval",
              kind: "approval.requested",
              summary: "Command approval requested",
              payload: { requestId: "approval-1", requestKind: "command" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.500Z",
            },
            {
              id: asEventId("activity-3"),
              tone: "info",
              kind: "user-input.requested",
              summary: "User input requested",
              payload: {
                requestId: "input-1",
                questions: [
                  {
                    id: "q-1",
                    header: "Mode",
                    question: "Choose",
                    options: [{ label: "A", description: "Pick A" }],
                  },
                ],
              },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.750Z",
            },
          ],
          pendingInteractions: [],
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-1"),
              status: "ready",
              files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: asMessageId("message-1"),
              completedAt: "2026-02-24T00:00:08.000Z",
            },
          ],
          session: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
        },
      ]);
    }),
  );
});
