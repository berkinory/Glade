import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { Effect, Schema } from "effect";
import { toPersistenceSqlOrDecodeError } from "../../persistence/Errors";

const ThreadIdRows = Schema.Array(Schema.Struct({ threadId: ThreadId }));

const Rows = Schema.Array(
  Schema.Struct({
    threadId: Schema.String,
    activity: Schema.fromJsonString(OrchestrationThreadActivity),
  }),
);

// Task activities of each thread's latest turn, joined as `a`. The latest turn is resolved once per
// thread: a correlated subquery per activity row made SQLite walk every activity of the thread and
// re-sort its turns for each task row. The kind list must stay identical to the predicate of
// idx_projection_thread_activities_background_work, or SQLite stops using that partial index.
// Pending turn-start rows have no turn id yet; counting them would hide the running turn's tasks
// whenever a steer or follow-up is requested, which reads as the turn settling.
const latestTurnTaskActivities = (sql: SqlClient, threadIds?: readonly ThreadId[]) => sql`
  (
    SELECT thread_id, turn_id, requested_at
    FROM (
      SELECT thread_id, turn_id, requested_at,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY requested_at DESC, turn_id DESC) AS turn_rank
      FROM projection_turns
      WHERE ${threadIds ? sql.in("thread_id", threadIds) : sql`1 = 1`} AND turn_id IS NOT NULL
    )
    WHERE turn_rank = 1
  ) latest
  JOIN projection_thread_activities a ON a.thread_id = latest.thread_id
    AND a.kind IN ('task.started', 'task.updated', 'task.progress', 'task.completed', 'background-work.reset')
    AND (a.turn_id = latest.turn_id OR (a.turn_id IS NULL AND a.created_at >= latest.requested_at))
`;

export function readThreadIdsWithBackgroundActivity(sql: SqlClient) {
  return sql<{ threadId: string }>`
    SELECT DISTINCT a.thread_id AS "threadId"
    FROM ${latestTurnTaskActivities(sql)}
  `.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ThreadIdRows)),
    Effect.map((rows) => rows.map((row) => row.threadId)),
    Effect.mapError(
      toPersistenceSqlOrDecodeError("backgroundWork:threads", "backgroundWork:decode"),
    ),
  );
}

export function readBackgroundActivities(sql: SqlClient, threadIds?: readonly ThreadId[]) {
  return sql<{ threadId: string; activity: string }>`
    SELECT a.thread_id AS "threadId", json_object('id', a.activity_id, 'kind', a.kind,
      'turnId', a.turn_id, 'payload', json_object('taskId', json_extract(a.payload_json, '$.taskId'), 'taskType', json_extract(a.payload_json, '$.taskType'), 'status', json_extract(a.payload_json, '$.status'), 'isBackgrounded', json(CASE json_extract(a.payload_json, '$.isBackgrounded') WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END), 'wakesAgent', json(CASE json_extract(a.payload_json, '$.wakesAgent') WHEN 1 THEN 'true' ELSE 'null' END)), 'createdAt', a.created_at,
      'tone', a.tone, 'summary', a.summary, 'sequence', a.sequence) AS activity
    FROM ${latestTurnTaskActivities(sql, threadIds)}
    ORDER BY a.created_at, a.activity_id
  `.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
    Effect.map((rows) => {
      const byThread = new Map<string, OrchestrationThreadActivity[]>();
      for (const row of rows) {
        const activities = byThread.get(row.threadId) ?? [];
        activities.push(row.activity);
        byThread.set(row.threadId, activities);
      }
      return (threadId: ThreadId) => byThread.get(threadId) ?? [];
    }),
    Effect.mapError(toPersistenceSqlOrDecodeError("backgroundWork:query", "backgroundWork:decode")),
  );
}
