import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Stale provider callback failures used to leave their interaction `uncertain`, which clients treat as
// still answerable. They are terminal now; settle rows that already carry that failure so restart
// recovery does not report them again. Matching follows the stale-interaction matcher: same request
// generation, or a generation-less failure recorded at or after the request.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    WITH stale AS (
      SELECT
        pending.thread_id,
        pending.interaction_kind,
        pending.request_id,
        MAX(activity.created_at) AS resolved_at
      FROM projection_pending_interactions AS pending
      JOIN projection_thread_activities AS activity
        ON activity.thread_id = pending.thread_id
        AND activity.kind = CASE pending.interaction_kind
          WHEN 'approval' THEN 'provider.approval.respond.failed'
          ELSE 'provider.user-input.respond.failed'
        END
        AND json_extract(activity.payload_json, '$.requestId') = pending.request_id
      WHERE pending.status = 'uncertain'
        AND (
          json_extract(activity.payload_json, '$.detail') LIKE '%stale pending % request%'
          OR json_extract(activity.payload_json, '$.detail') LIKE '%unknown pending % request%'
        )
        AND (
          (
            pending.lifecycle_generation IS NOT NULL
            AND json_extract(activity.payload_json, '$.lifecycleGeneration') =
              pending.lifecycle_generation
          )
          OR (
            COALESCE(json_extract(activity.payload_json, '$.lifecycleGeneration'), '') = ''
            AND activity.created_at >= pending.created_at
          )
        )
      GROUP BY pending.thread_id, pending.interaction_kind, pending.request_id
    )
    UPDATE projection_pending_interactions
    SET status = 'confirmed',
      resolved_at = (
        SELECT stale.resolved_at FROM stale
        WHERE stale.thread_id = projection_pending_interactions.thread_id
          AND stale.interaction_kind = projection_pending_interactions.interaction_kind
          AND stale.request_id = projection_pending_interactions.request_id
      )
    WHERE status = 'uncertain'
      AND EXISTS (
        SELECT 1 FROM stale
        WHERE stale.thread_id = projection_pending_interactions.thread_id
          AND stale.interaction_kind = projection_pending_interactions.interaction_kind
          AND stale.request_id = projection_pending_interactions.request_id
      )
  `;
});
