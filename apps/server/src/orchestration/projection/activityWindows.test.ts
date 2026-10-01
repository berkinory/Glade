import { Effect, Option } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { projectionSnapshotLayer, asEventId, asThreadId, asTurnId } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot activityWindows", (it) => {
  it.effect("limits hydrated thread activities to the latest activity window", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
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
          'project-activity-cap',
          'Project Activity Cap',
          '/tmp/project-activity-cap',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z',
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
          'thread-activity-cap',
          'project-activity-cap',
          'Thread Activity Cap',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z',
          NULL
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
          sequence,
          created_at
        )
        VALUES (
          'approval-old',
          'thread-activity-cap',
          NULL,
          'approval',
          'approval.requested',
          'Command approval requested',
          '{"requestId":"approval-1","requestKind":"command"}',
          0,
          '2026-02-24T00:00:00.000Z'
        )
      `;

      for (let index = 0; index < 505; index += 1) {
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at
          )
          VALUES (
            ${`activity-${index}`},
            'thread-activity-cap',
            NULL,
            'tool',
            'tool.completed',
            'Tool completed',
            '{"stage":"completed"}',
            ${index + 1},
            '2026-02-24T00:00:00.000Z'
          )
        `;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();
      const snapshotActivities = snapshot.threads[0]?.activities ?? [];
      assert.equal(snapshotActivities.length, 501);
      assert.equal(snapshotActivities[0]?.id, asEventId("approval-old"));
      assert.equal(snapshotActivities[1]?.id, asEventId("activity-5"));
      assert.equal(snapshotActivities.at(-1)?.id, asEventId("activity-504"));

      const detail = yield* snapshotQuery.getThreadDetailById(asThreadId("thread-activity-cap"));
      assert.isTrue(Option.isSome(detail));
      const detailActivities = Option.isSome(detail) ? detail.value.activities : [];
      assert.equal(detailActivities.length, 506);
      assert.equal(detailActivities[0]?.id, asEventId("approval-old"));
      assert.equal(detailActivities[1]?.id, asEventId("activity-0"));
      assert.equal(detailActivities.at(-1)?.id, asEventId("activity-504"));

      yield* sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id = 'thread-activity-cap'
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
          sequence,
          created_at
        )
        VALUES
          (
            'approval-old',
            'thread-activity-cap',
            NULL,
            'approval',
            'approval.requested',
            'Command approval requested',
            '{"requestId":"approval-1","requestKind":"command"}',
            0,
            '2026-02-24T00:00:00.000Z'
          ),
          (
            'approval-resolved-old',
            'thread-activity-cap',
            NULL,
            'approval',
            'approval.resolved',
            'Command approval resolved',
            '{"requestId":"approval-1","decision":"accept"}',
            1,
            '2026-02-24T00:00:00.000Z'
          )
      `;

      for (let index = 0; index < 505; index += 1) {
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at
          )
          VALUES (
            ${`resolved-activity-${index}`},
            'thread-activity-cap',
            NULL,
            'tool',
            'tool.completed',
            'Tool completed',
            '{"stage":"completed"}',
            ${index + 2},
            '2026-02-24T00:00:00.000Z'
          )
        `;
      }

      const resolvedSnapshot = yield* snapshotQuery.getSnapshot();
      const resolvedSnapshotActivities = resolvedSnapshot.threads[0]?.activities ?? [];
      assert.equal(resolvedSnapshotActivities.length, 500);
      assert.equal(resolvedSnapshotActivities[0]?.id, asEventId("resolved-activity-5"));
      assert.equal(resolvedSnapshotActivities.at(-1)?.id, asEventId("resolved-activity-504"));

      const resolvedDetail = yield* snapshotQuery.getThreadDetailById(
        asThreadId("thread-activity-cap"),
      );
      assert.isTrue(Option.isSome(resolvedDetail));
      const resolvedDetailActivities = Option.isSome(resolvedDetail)
        ? resolvedDetail.value.activities
        : [];
      assert.equal(resolvedDetailActivities.length, 507);
      assert.equal(resolvedDetailActivities[0]?.id, asEventId("approval-old"));
      assert.equal(resolvedDetailActivities[1]?.id, asEventId("approval-resolved-old"));
      assert.equal(resolvedDetailActivities.at(-1)?.id, asEventId("resolved-activity-504"));
    }),
  );

  it.effect("aligns the thread detail activity window to a turn boundary", () =>
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
          'project-turn-window', 'Turn window', '/tmp/turn-window',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-turn-window', 'project-turn-window', 'Turn Window',
          '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:00.000Z', NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        )
        WITH RECURSIVE sequences(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM sequences WHERE n < 2150
        )
        SELECT
          'activity-' || n,
          'thread-turn-window',
          CASE
            WHEN n <= 50 THEN 'turn-old'
            WHEN n <= 250 THEN 'turn-cutoff'
            ELSE 'turn-recent'
          END,
          'tool',
          'tool.completed',
          'Tool completed',
          '{"stage":"completed"}',
          n,
          '2026-02-24T00:00:00.000Z'
        FROM sequences
      `;

      const detail = yield* snapshotQuery.getThreadDetailById(asThreadId("thread-turn-window"));
      assert.isTrue(Option.isSome(detail));
      const detailActivities = Option.isSome(detail) ? detail.value.activities : [];

      assert.equal(detailActivities.length, 1_900);
      assert.equal(detailActivities[0]?.id, asEventId("activity-251"));
      assert.equal(detailActivities[0]?.turnId, asTurnId("turn-recent"));
      assert.equal(detailActivities.at(-1)?.id, asEventId("activity-2150"));
      assert.equal(
        detailActivities.filter((activity) => activity.turnId === asTurnId("turn-cutoff")).length,
        0,
      );

      assert.isFalse(detailActivities.some((activity) => activity.turnId === asTurnId("turn-old")));

      const snapshot = yield* snapshotQuery.getSnapshot();
      const snapshotActivities = snapshot.threads[0]?.activities ?? [];
      assert.equal(snapshotActivities.length, 500);
      assert.equal(snapshotActivities[0]?.id, asEventId("activity-1651"));
      assert.equal(snapshotActivities.at(-1)?.id, asEventId("activity-2150"));
    }),
  );

  it.effect("keeps a single oversized turn capped instead of dropping the whole window", () =>
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
          'project-oversized-turn', 'Oversized turn', '/tmp/oversized-turn',
          '{"provider":"codex","model":"gpt-5-codex"}', '[]',
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-oversized-turn', 'project-oversized-turn', 'Oversized Turn',
          '{"provider":"codex","model":"gpt-5-codex"}', NULL, NULL, NULL,
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary,
          payload_json, sequence, created_at
        )
        WITH RECURSIVE sequences(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM sequences WHERE n < 2150
        )
        SELECT
          'oversized-activity-' || n,
          'thread-oversized-turn',
          'turn-oversized',
          'tool',
          'tool.completed',
          'Tool completed',
          '{"stage":"completed"}',
          n,
          '2026-02-24T00:00:00.000Z'
        FROM sequences
      `;

      const detail = yield* snapshotQuery.getThreadDetailById(asThreadId("thread-oversized-turn"));
      assert.isTrue(Option.isSome(detail));
      const activities = Option.isSome(detail) ? detail.value.activities : [];

      assert.equal(activities.length, 2_000);
      assert.equal(activities[0]?.id, asEventId("oversized-activity-151"));
      assert.equal(activities.at(-1)?.id, asEventId("oversized-activity-2150"));

      yield* sql`UPDATE projection_thread_activities SET kind = 'context-window.updated'
        WHERE activity_id IN ('oversized-activity-1', 'oversized-activity-2000')`;
      yield* sql`UPDATE projection_thread_activities SET kind = 'turn.completed'
        WHERE activity_id = 'oversized-activity-2001'`;
      yield* sql`INSERT INTO provider_runtime_events (event_id, thread_id, event_type, event_json, persisted_at)
        VALUES ('oversized-activity-2000', 'thread-oversized-turn', 'thread.token-usage.updated',
          '{"provider":"codex","providerRefs":{"providerThreadId":"provider-session"},"raw":{"payload":{"tokenUsage":{"total":{"inputTokens":3000,"outputTokens":30,"cachedInputTokens":2000,"cacheWriteInputTokens":500}}}}}',
          '2026-02-24T00:00:00.000Z')`;
      const updated = yield* snapshotQuery.getThreadDetailById(asThreadId("thread-oversized-turn"));
      const retained = Option.isSome(updated) ? updated.value.activities : [];
      assert.equal(retained.length, 2000);
      assert.deepEqual(
        retained.find((activity) => activity.id === "oversized-activity-2000")?.payload,
        {
          stage: "completed",
          usageSessionId: "provider-session",
          cumulativeUsage: {
            inputTokens: 3000,
            outputTokens: 30,
            cachedInputTokens: 2000,
            cacheCreationInputTokens: 500,
          },
        },
      );
      assert.isFalse(retained.some((activity) => activity.id === "oversized-activity-1"));
      assert.isTrue(retained.some((activity) => activity.id === "oversized-activity-2000"));
      assert.isTrue(retained.some((activity) => activity.id === "oversized-activity-2001"));
      const bulk = yield* snapshotQuery.getSnapshot();
      assert.equal(bulk.threads[0]?.activities.length, 500);
      assert.isTrue(
        bulk.threads[0]?.activities.some((activity) => activity.id === "oversized-activity-2000"),
      );
      assert.isTrue(
        bulk.threads[0]?.activities.some((activity) => activity.id === "oversized-activity-2001"),
      );
    }),
  );
});
