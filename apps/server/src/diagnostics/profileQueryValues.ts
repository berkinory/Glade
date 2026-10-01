import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface CountRow {
  readonly count: number;
}

export interface PromptActivityRow extends CountRow {
  readonly day: string | null;
  readonly hour: number | null;
}

export interface TurnInsightRow extends CountRow {
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
}

export interface MostWorkedProjectRow {
  readonly projectId: string | null;
  readonly title: string | null;
  readonly workspaceRoot: string | null;
  readonly promptCount: number;
  readonly threadCount: number;
  readonly activeDays: number;
  readonly lastWorkedAt: string | null;
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
