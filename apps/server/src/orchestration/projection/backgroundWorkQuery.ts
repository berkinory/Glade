import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { Effect, Schema } from "effect";
import { toPersistenceSqlOrDecodeError } from "../../persistence/Errors";

const Rows = Schema.Array(
  Schema.Struct({
    threadId: Schema.String,
    activity: Schema.fromJsonString(OrchestrationThreadActivity),
  }),
);

export function readBackgroundActivities(sql: SqlClient, threadIds?: readonly ThreadId[]) {
  return sql<{ threadId: string; activity: string }>`
    SELECT a.thread_id AS "threadId", json_object('id', a.activity_id, 'kind', a.kind,
      'turnId', a.turn_id, 'payload', json_object('taskId', json_extract(a.payload_json, '$.taskId'), 'taskType', json_extract(a.payload_json, '$.taskType'), 'status', json_extract(a.payload_json, '$.status'), 'isBackgrounded', json(CASE json_extract(a.payload_json, '$.isBackgrounded') WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END)), 'createdAt', a.created_at,
      'tone', a.tone, 'summary', a.summary, 'sequence', a.sequence) AS activity
    FROM projection_thread_activities a
    WHERE ${threadIds ? sql.in("a.thread_id", threadIds) : sql`1 = 1`}
      AND a.kind IN ('task.started', 'task.updated', 'task.progress', 'task.completed', 'background-work.reset')
      AND (a.turn_id = (SELECT t.turn_id FROM projection_turns t WHERE t.thread_id = a.thread_id ORDER BY t.requested_at DESC, t.turn_id DESC LIMIT 1)
        OR (a.turn_id IS NULL AND a.created_at >= (SELECT MAX(t.requested_at) FROM projection_turns t WHERE t.thread_id = a.thread_id)))
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
