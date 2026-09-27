import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("retire providers migration", (it) => {
  it.effect("preserves old rows while removing their runnable state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 109 });

      yield* sql`
        INSERT INTO provider_runtime_events
          (event_id, thread_id, turn_id, event_type, event_json, persisted_at)
        VALUES
          ('old-event', 'old-thread', 'old-turn', 'session.started',
           '{"provider":"pi","eventId":"old-event"}', '2026-01-01T00:00:00Z'),
          ('current-event', 'current-thread', 'current-turn', 'session.started',
           '{"provider":"codex","eventId":"current-event"}', '2026-01-01T00:00:00Z')
      `;
      yield* sql`
        INSERT INTO provider_runtime_open_turns
          (thread_id, turn_id, first_sequence, updated_at)
        VALUES ('old-thread', 'old-turn', 1, '2026-01-01T00:00:00Z')
      `;
      yield* sql`
        INSERT INTO provider_session_runtime
          (thread_id, provider_name, adapter_key, status, last_seen_at)
        VALUES
          ('old-thread', 'pi', 'pi', 'ready', '2026-01-01T00:00:00Z'),
          ('current-thread', 'codex', 'codex', 'ready', '2026-01-01T00:00:00Z')
      `;
      yield* sql`
        INSERT INTO automation_definitions (
          automation_id, project_id, name, prompt, schedule_json, enabled,
          next_run_at, model_selection_json, runtime_mode, interaction_mode,
          worktree_mode, mode, stop_on_error, minimum_interval_seconds,
          retry_policy_json, misfire_policy, acknowledged_risks_json,
          iteration_count, created_at, updated_at
        ) VALUES (
          'old-automation', 'project', 'old', 'prompt', '{"type":"once"}', 1,
          '2026-01-02T00:00:00Z', '{"provider":"pi","model":"pi-model"}',
          'full-access', 'default', 'local', 'cron', 0, 60,
          '{}', 'skip', '[]', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
      `;

      yield* runMigrations();

      const events = yield* sql<{ event_id: string }>`SELECT event_id FROM provider_runtime_events`;
      assert.deepStrictEqual(
        events.map((row) => row.event_id),
        ["current-event"],
      );
      const archivedEvents = yield* sql<{ event_id: string }>`
        SELECT event_id FROM retired_provider_runtime_events
      `;
      assert.deepStrictEqual(
        archivedEvents.map((row) => row.event_id),
        ["old-event"],
      );
      const openTurns = yield* sql`SELECT * FROM provider_runtime_open_turns`;
      assert.lengthOf(openTurns, 0);

      const sessions = yield* sql<{ thread_id: string }>`
        SELECT thread_id FROM provider_session_runtime
      `;
      assert.deepStrictEqual(
        sessions.map((row) => row.thread_id),
        ["current-thread"],
      );
      const archivedSessions = yield* sql<{ thread_id: string }>`
        SELECT thread_id FROM retired_provider_session_runtime
      `;
      assert.deepStrictEqual(
        archivedSessions.map((row) => row.thread_id),
        ["old-thread"],
      );

      const [automation] = yield* sql<{
        enabled: number;
        disabled_reason: string | null;
        model_selection_json: string;
      }>`
        SELECT enabled, disabled_reason, model_selection_json
        FROM automation_definitions WHERE automation_id = 'old-automation'
      `;
      assert.strictEqual(automation?.enabled, 0);
      assert.isNull(automation?.disabled_reason);
      assert.deepStrictEqual(JSON.parse(automation?.model_selection_json ?? "null"), {
        provider: "codex",
        model: "gpt-6-astra",
      });
      const [archivedAutomation] = yield* sql<{ model_selection_json: string }>`
        SELECT model_selection_json FROM retired_provider_automation_definitions
        WHERE automation_id = 'old-automation'
      `;
      assert.strictEqual(
        JSON.parse(archivedAutomation?.model_selection_json ?? "null").provider,
        "pi",
      );
    }),
  );
});
