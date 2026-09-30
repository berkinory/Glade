import { Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { projectionSnapshotLayer, asProjectId, asThreadId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot persistedMetadata", (it) => {
  it.effect("normalizes imported Glade model-selection shapes from projection reads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_thread_sessions`;

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
          'project-imported-shape',
          'Imported Shape Project',
          '/tmp/imported-shape',
          '{"instanceId":"codex","model":"imported-project-model","options":[{"id":"reasoningEffort","value":"medium"}]}',
          '[]',
          '2026-05-05T14:39:18.000Z',
          '2026-05-05T14:39:19.000Z',
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
          runtime_mode,
          interaction_mode,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-imported-shape',
          'project-imported-shape',
          'Imported Shape Thread',
          '{"provider":"codex","model":"gpt-5.5","options":[{"id":"reasoningEffort","value":"medium"}]}',
          NULL,
          NULL,
          'full-access',
          'default',
          NULL,
          '2026-05-05T14:39:20.000Z',
          '2026-05-05T14:39:21.000Z',
          NULL
        )
      `;

      const expectedProjectSelection = {
        provider: "codex",
        model: "imported-project-model",
        options: { reasoningEffort: "medium" },
      } as const;
      const expectedThreadSelection = {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "medium" },
      } as const;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      const activeProject =
        yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/imported-shape");
      const projectShell = yield* snapshotQuery.getProjectShellById(
        asProjectId("project-imported-shape"),
      );
      const threadShell = yield* snapshotQuery.getThreadShellById(
        asThreadId("thread-imported-shape"),
      );
      const threadDetail = yield* snapshotQuery.getThreadDetailById(
        asThreadId("thread-imported-shape"),
      );
      const threadDetailSnapshot = yield* snapshotQuery.getThreadDetailSnapshotById(
        asThreadId("thread-imported-shape"),
      );

      assert.deepStrictEqual(
        snapshot.projects.find((project) => project.id === "project-imported-shape")
          ?.defaultModelSelection,
        expectedProjectSelection,
      );
      assert.deepStrictEqual(
        snapshot.threads.find((thread) => thread.id === "thread-imported-shape")?.modelSelection,
        expectedThreadSelection,
      );
      assert.deepStrictEqual(
        shellSnapshot.projects.find((project) => project.id === "project-imported-shape")
          ?.defaultModelSelection,
        expectedProjectSelection,
      );
      assert.deepStrictEqual(
        shellSnapshot.threads.find((thread) => thread.id === "thread-imported-shape")
          ?.modelSelection,
        expectedThreadSelection,
      );
      assert.deepStrictEqual(
        Option.getOrNull(activeProject)?.defaultModelSelection,
        expectedProjectSelection,
      );
      assert.deepStrictEqual(
        Option.getOrNull(projectShell)?.defaultModelSelection,
        expectedProjectSelection,
      );
      assert.deepStrictEqual(
        Option.getOrNull(threadShell)?.modelSelection,
        expectedThreadSelection,
      );
      assert.deepStrictEqual(
        Option.getOrNull(threadDetail)?.modelSelection,
        expectedThreadSelection,
      );
      assert.deepStrictEqual(
        Option.getOrNull(threadDetailSnapshot)?.thread.modelSelection,
        expectedThreadSelection,
      );
    }),
  );

  it.effect("preserves project kind in read and shell snapshots", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          kind,
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
            'project-folder',
            'project',
            'Folder Project',
            '/tmp/folder-project',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-02-25T00:00:00.000Z',
            '2026-02-25T00:00:01.000Z',
            NULL
          ),
          (
            'project-chat',
            'chat',
            'Home',
            '/Users/tester',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-02-25T00:00:02.000Z',
            '2026-02-25T00:00:03.000Z',
            NULL
          )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      assert.deepEqual(
        snapshot.projects.map((project) => ({ id: project.id, kind: project.kind })),
        [
          { id: asProjectId("project-folder"), kind: "project" },
          { id: asProjectId("project-chat"), kind: "chat" },
        ],
      );

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.projects.map((project) => ({ id: project.id, kind: project.kind })),
        [
          { id: asProjectId("project-folder"), kind: "project" },
          { id: asProjectId("project-chat"), kind: "chat" },
        ],
      );

      const chatProject = yield* snapshotQuery.getProjectShellById(asProjectId("project-chat"));
      assert.equal(chatProject._tag, "Some");
      if (chatProject._tag === "Some") {
        assert.equal(chatProject.value.kind, "chat");
      }

      const activeByWorkspaceRoot =
        yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/Users/tester");
      assert.equal(activeByWorkspaceRoot._tag, "Some");
      if (activeByWorkspaceRoot._tag === "Some") {
        assert.equal(activeByWorkspaceRoot.value.kind, "chat");
      }
    }),
  );

  it.effect("decodes persisted lastKnownPr JSON in read and shell snapshots", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          kind,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-pr',
          'project',
          'PR Project',
          '/tmp/pr-project',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-02-25T00:00:00.000Z',
          '2026-02-25T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          last_known_pr_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-pr',
          'project-pr',
          'Thread with PR',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '{"number":1,"title":"Add placeholder temp files","url":"https://github.com/Emanuele-web04/openclap/pull/1","baseBranch":"main","headBranch":"glade/greeting-1","state":"open"}',
          '2026-02-25T00:00:02.000Z',
          '2026-02-25T00:00:03.000Z',
          NULL
        )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      assert.equal(snapshot.threads[0]?.lastKnownPr?.number, 1);
      assert.equal(snapshot.threads[0]?.lastKnownPr?.state, "open");

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.threads[0]?.lastKnownPr?.number, 1);
      assert.equal(shellSnapshot.threads[0]?.lastKnownPr?.headBranch, "glade/greeting-1");
    }),
  );
});
