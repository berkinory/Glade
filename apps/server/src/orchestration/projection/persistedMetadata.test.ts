import { Effect } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { projectionSnapshotLayer, asProjectId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot persistedMetadata", (it) => {
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
