import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface DayCountRow {
  readonly day: string | null;
  readonly count: number;
}

export interface TokenDayRow {
  readonly day: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tokens: number;
}

export function sqliteModifierFromUtcOffsetMinutes(offsetMinutes: number): string {
  const safe = Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : 0;
  const sign = safe < 0 ? "-" : "+";
  const abs = Math.abs(safe);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function num(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function turnModelSelectionCte(
  sql: SqlClient.SqlClient,
  scope?: { readonly threadId: string },
) {
  const turnThreadMatch = scope
    ? sql`${scope.threadId}`
    : sql.literal("json_extract(e.payload_json, '$.threadId')");
  const eventThreadScope = scope
    ? sql`AND COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id) = ${scope.threadId}`
    : sql.literal("");
  return sql`
    SELECT
      pt.thread_id AS thread_id,
      pt.turn_id AS turn_id,
      MAX(json_extract(e.payload_json, '$.modelSelection.provider')) AS provider,
      COALESCE(
        (SELECT CASE WHEN COUNT(DISTINCT json_extract(r.event_json, '$.payload.model')) = 1
          THEN MAX(json_extract(r.event_json, '$.payload.model')) END
         FROM provider_runtime_events r
         WHERE r.thread_id = pt.thread_id AND r.turn_id = pt.turn_id
           AND r.event_type = 'turn.started'
           AND json_valid(r.event_json)
           AND json_extract(r.event_json, '$.provider') =
             MAX(json_extract(e.payload_json, '$.modelSelection.provider'))
           AND NULLIF(TRIM(json_extract(r.event_json, '$.payload.model')), '') IS NOT NULL
           AND json_extract(r.event_json, '$.payload.model') != 'provider-default'
           AND NOT (json_extract(r.event_json, '$.provider') = 'claudeAgent'
             AND json_extract(r.event_json, '$.payload.model') = 'default')),
        MAX(json_extract(e.payload_json, '$.modelSelection.model'))
      ) AS model
    FROM orchestration_events e
    JOIN projection_turns pt
      ON pt.thread_id = ${turnThreadMatch}
     AND pt.pending_message_id = json_extract(e.payload_json, '$.messageId')
    WHERE e.event_type = 'thread.turn-start-requested'
      ${eventThreadScope}
      AND pt.turn_id IS NOT NULL
      AND json_type(e.payload_json, '$.modelSelection') = 'object'
    GROUP BY pt.thread_id, pt.turn_id
  `;
}

// Cumulative token counters belong to one native provider session, so token deltas are partitioned by
// it. The stored id appends the runtime generation. Codex restores a native thread's lifetime
// counter when it resumes, so for Codex only the native id may start a new baseline. ACP counters are
// Glade's own per-runtime sums and restart on resume, so each generation is its own series. Rows
// without an id share one legacy series.
export function tokenUsageSessionIdSql(sql: SqlClient.SqlClient) {
  return sql.literal(`COALESCE(
    CASE WHEN json_extract(a.payload_json, '$.provider') = 'codex'
      AND INSTR(json_extract(a.payload_json, '$.usageSessionId'), ':') > 0
      THEN SUBSTR(json_extract(a.payload_json, '$.usageSessionId'), 1,
        INSTR(json_extract(a.payload_json, '$.usageSessionId'), ':') - 1)
      ELSE json_extract(a.payload_json, '$.usageSessionId')
    END, '')`);
}

// Active agent time per turn: the gaps between a turn's events (its start, activities and
// completion), each capped so a turn left waiting (an unanswered approval, an abandoned interrupt)
// adds at most the cap. A turn is dated by its first event. Provider-native threads mirror
// subagents that run inside a parent turn already counted.
export function agentTurnSecondsCtes(
  sql: SqlClient.SqlClient,
  scope?: { readonly threadId: string },
) {
  const activityScope = scope ? sql`AND a.thread_id = ${scope.threadId}` : sql.literal("");
  const turnScope = scope ? sql`AND thread_id = ${scope.threadId}` : sql.literal("");
  return sql`
    agent_turn_events AS (
      SELECT a.thread_id, a.turn_id, a.created_at AS at
      FROM projection_thread_activities a
      WHERE a.turn_id IS NOT NULL ${activityScope}
      UNION ALL
      SELECT thread_id, turn_id, started_at FROM projection_turns
      WHERE turn_id IS NOT NULL AND started_at IS NOT NULL ${turnScope}
      UNION ALL
      SELECT thread_id, turn_id, completed_at FROM projection_turns
      WHERE turn_id IS NOT NULL AND completed_at IS NOT NULL ${turnScope}
    ),
    agent_turn_gaps AS (
      SELECT thread_id, turn_id, at,
        (julianday(at) - julianday(LAG(at) OVER (PARTITION BY thread_id, turn_id ORDER BY at)))
          * 86400 AS gap
      FROM agent_turn_events
    ),
    agent_turn_seconds AS (
      SELECT g.thread_id, MIN(g.at) AS started_at,
        CAST(ROUND(COALESCE(SUM(MIN(g.gap, 300)), 0)) AS INTEGER) AS seconds
      FROM agent_turn_gaps g
      JOIN projection_threads th ON th.thread_id = g.thread_id
      WHERE COALESCE(th.creation_source, '') != 'provider_native'
      GROUP BY g.thread_id, g.turn_id
      HAVING seconds > 0
    )
  `;
}
