import { ProjectId, SpaceId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionStateRepositoryLive } from "./ProjectionState.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionStateRepository } from "../Services/ProjectionState.ts";
import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive,
    ProjectionThreadRepositoryLive,
    ProjectionStateRepositoryLive,
    ProjectionTurnRepositoryLive,
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("clears active and soft-deleted project assignments for a deleted space", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const spaceId = SpaceId.makeUnsafe("space-delete-bulk");
      const makeProject = (projectId: string, updatedAt: string, deletedAt: string | null) => ({
        projectId: ProjectId.makeUnsafe(projectId),
        kind: "project" as const,
        title: projectId,
        workspaceRoot: `/tmp/${projectId}`,
        defaultModelSelection: null,
        isPinned: false,
        spaceId,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt,
        deletedAt,
      });
      yield* projects.upsert(makeProject("project-space-active", "2026-07-20T00:00:01.000Z", null));
      yield* projects.upsert(
        makeProject(
          "project-space-deleted",
          "2026-07-20T00:00:03.000Z",
          "2026-07-20T00:00:02.000Z",
        ),
      );

      yield* projects.clearSpaceAssignments({
        spaceId,
        updatedAt: "2026-07-20T00:00:02.000Z",
      });

      const rows = yield* projects.listAll();
      assert.deepStrictEqual(
        rows.map(({ projectId, spaceId: assignedSpaceId, updatedAt }) => ({
          projectId,
          assignedSpaceId,
          updatedAt,
        })),
        [
          {
            projectId: ProjectId.makeUnsafe("project-space-active"),
            assignedSpaceId: null,
            updatedAt: "2026-07-20T00:00:02.000Z",
          },
          {
            projectId: ProjectId.makeUnsafe("project-space-deleted"),
            assignedSpaceId: null,
            updatedAt: "2026-07-20T00:00:03.000Z",
          },
        ],
      );
    }),
  );

  it.effect("round-trips project default model selection JSON", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.makeUnsafe("project-null-options"),
        kind: "project",
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        isPinned: false,
        spaceId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      assert.deepStrictEqual(rows, [
        { defaultModelSelection: JSON.stringify({ provider: "codex", model: "gpt-5.4" }) },
      ]);

      const persisted = yield* projects.getById({
        projectId: ProjectId.makeUnsafe("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("keeps projection cursors monotonic during concurrent catch-up", () =>
    Effect.gen(function* () {
      const states = yield* ProjectionStateRepository;

      yield* states.upsert({
        projector: "projection.hot",
        lastAppliedSequence: 20,
        updatedAt: "2026-07-09T00:00:20.000Z",
      });
      yield* states.upsert({
        projector: "projection.hot",
        lastAppliedSequence: 10,
        updatedAt: "2026-07-09T00:00:10.000Z",
      });

      const persisted = yield* states.getByProjector({ projector: "projection.hot" });
      assert.deepStrictEqual(Option.getOrNull(persisted), {
        projector: "projection.hot",
        lastAppliedSequence: 20,
        updatedAt: "2026-07-09T00:00:20.000Z",
      });
    }),
  );

  it.effect("batches pinned turn state with current thread existence", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const turns = yield* ProjectionTurnRepository;
      const now = "2026-07-19T00:00:00.000Z";
      const makeThread = (threadId: string, deletedAt: string | null) => ({
        threadId: ThreadId.makeUnsafe(threadId),
        projectId: ProjectId.makeUnsafe("project-wait-snapshot"),
        title: threadId,
        modelSelection: { provider: "codex" as const, model: "gpt-5.5" },
        runtimeMode: "approval-required" as const,

        envMode: "local" as const,
        branch: null,
        worktreePath: null,
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
        createBranchFlowCompleted: false,
        lastKnownPr: null,
        latestTurnId: null,
        handoff: null,
        pinnedMessages: null,
        notes: null,

        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,

        createdAt: now,
        updatedAt: now,
        deletedAt,
      });
      yield* threads.upsert(makeThread("thread-wait-active", null));
      yield* threads.upsert(makeThread("thread-wait-deleted", now));
      yield* turns.upsertByTurnId({
        threadId: ThreadId.makeUnsafe("thread-wait-active"),
        turnId: TurnId.makeUnsafe("turn-wait-active"),
        pendingMessageId: null,

        assistantMessageId: null,
        state: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      yield* turns.upsertByTurnId({
        threadId: ThreadId.makeUnsafe("thread-wait-deleted"),
        turnId: TurnId.makeUnsafe("turn-wait-deleted"),
        pendingMessageId: null,

        assistantMessageId: null,
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });

      const snapshot = yield* turns.getManyWaitSnapshot({
        threadIds: [
          ThreadId.makeUnsafe("thread-wait-active"),
          ThreadId.makeUnsafe("thread-wait-deleted"),
          ThreadId.makeUnsafe("thread-wait-missing"),
        ],
        turns: [
          {
            threadId: ThreadId.makeUnsafe("thread-wait-active"),
            turnId: TurnId.makeUnsafe("turn-wait-active"),
          },
          {
            threadId: ThreadId.makeUnsafe("thread-wait-deleted"),
            turnId: TurnId.makeUnsafe("turn-wait-deleted"),
          },
        ],
      });
      assert.deepStrictEqual(snapshot.existingThreadIds, [
        ThreadId.makeUnsafe("thread-wait-active"),
      ]);
      assert.deepStrictEqual(snapshot.turns, [
        {
          threadId: ThreadId.makeUnsafe("thread-wait-active"),
          turnId: TurnId.makeUnsafe("turn-wait-active"),
          state: "running",
        },
      ]);
    }),
  );
});
