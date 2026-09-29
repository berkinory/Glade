import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS retired_provider_runtime_events AS
    SELECT * FROM provider_runtime_events WHERE 0
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retired_provider_runtime_events_sequence
    ON retired_provider_runtime_events(sequence)
  `;
  yield* sql`
    INSERT OR IGNORE INTO retired_provider_runtime_events
    SELECT * FROM provider_runtime_events
    WHERE json_extract(event_json, '$.provider') IN
      ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;
  yield* sql`
    DELETE FROM provider_runtime_events
    WHERE json_extract(event_json, '$.provider') IN
      ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;
  yield* sql`
    DELETE FROM provider_runtime_open_turns
    WHERE EXISTS (
      SELECT 1 FROM retired_provider_runtime_events AS event
      WHERE event.thread_id = provider_runtime_open_turns.thread_id
        AND event.turn_id = provider_runtime_open_turns.turn_id
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS retired_provider_session_runtime AS
    SELECT * FROM provider_session_runtime WHERE 0
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retired_provider_session_runtime_thread
    ON retired_provider_session_runtime(thread_id)
  `;
  yield* sql`
    INSERT OR IGNORE INTO retired_provider_session_runtime
    SELECT * FROM provider_session_runtime
    WHERE provider_name IN ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
       OR adapter_key IN ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;
  yield* sql`
    DELETE FROM provider_session_runtime
    WHERE provider_name IN ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
       OR adapter_key IN ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS retired_provider_automation_definitions AS
    SELECT * FROM automation_definitions WHERE 0
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retired_provider_automation_definitions_id
    ON retired_provider_automation_definitions(automation_id)
  `;
  yield* sql`
    INSERT OR IGNORE INTO retired_provider_automation_definitions
    SELECT * FROM automation_definitions
    WHERE json_extract(model_selection_json, '$.provider') IN
      ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;
  yield* sql`
    UPDATE automation_definitions
    SET enabled = 0,
        disabled_reason = NULL,
        disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        next_run_at = NULL,
        model_selection_json = '{"provider":"codex","model":"gpt-6-astra"}',
        provider_options_json = NULL
    WHERE json_extract(model_selection_json, '$.provider') IN
      ('antigravity', 'devin', 'droid', 'omp', 'pi', 'gemini')
  `;
});
