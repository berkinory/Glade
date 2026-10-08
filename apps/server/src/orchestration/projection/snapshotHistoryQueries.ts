import { VISUAL_REPLY_ACTIVITY_KIND } from "@glade/contracts/orchestration/visualReply";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlStatement from "effect/unstable/sql/Statement";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Schema } from "effect";
import { OrchestrationPendingInteraction } from "@glade/contracts/orchestration/threadEntities";
import {
  ProjectionThreadActivityDbRowSchema,
  MAX_SNAPSHOT_THREAD_ACTIVITIES,
  ProjectionThreadSessionDbRowSchema,
  ProjectionCheckpointDbRowSchema,
  ProjectionLatestTurnDbRowSchema,
  ThreadIdLookupInput,
  MAX_THREAD_DETAIL_ACTIVITIES,
  ThreadTurnLookupInput,
  ProjectionGeneratedImageActivityDbRowSchema,
  MAX_TURN_GENERATED_IMAGE_ACTIVITY_RECORDS,
} from "./snapshotSchemas";

export function makeSnapshotHistoryQueries(input: {
  readonly sql: SqlClient.SqlClient;
  readonly liveThreadScope: SqlStatement.Statement<SqlConnection.Row>;
}) {
  const { sql, liveThreadScope } = input;

  // Activity windows are capped, but a failed turn's outcome is transcript history. Its errors and
  // terminal events stay, so a later success or cancellation of the same turn still supersedes them.
  const turnFailureActivity = sql`
    kind = 'runtime.error'
    OR (kind = 'turn.completed' AND (
      tone = 'error' OR json_extract(payload_json, '$.state') = 'failed'
    ))
  `;
  const failedTurnTerminalActivity = (alias: "ranked" | "activity") => sql`
    ${sql.literal(alias)}.kind IN ('runtime.error', 'turn.completed')
    AND (${sql.literal(alias)}.thread_id, ${sql.literal(alias)}.turn_id) IN (
      SELECT thread_id, turn_id FROM failed_turns
    )
  `;

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        WITH failed_turns AS MATERIALIZED (
          SELECT DISTINCT thread_id, turn_id
          FROM projection_thread_activities
          WHERE ${liveThreadScope}
            AND turn_id IS NOT NULL
            AND (${turnFailureActivity})
        )
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          COALESCE((
            SELECT CASE WHEN json_type(totals, '$.inputTokens') = 'integer'
              AND json_type(totals, '$.outputTokens') = 'integer'
              THEN json_patch(ranked.payload_json, json_object(
                'cumulativeUsage', json_object(
                  'inputTokens', json_extract(totals, '$.inputTokens'),
                  'outputTokens', json_extract(totals, '$.outputTokens'),
                  'cachedInputTokens', json_extract(totals, '$.cachedInputTokens'),
                  'cacheCreationInputTokens', json_extract(totals, '$.cacheWriteInputTokens')
                ),
                'usageSessionId', session_id
              )) END
            FROM (
              SELECT json_extract(event_json, '$.raw.payload.tokenUsage.total') AS totals,
                json_extract(event_json, '$.providerRefs.providerThreadId') ||
                CASE WHEN json_type(event_json, '$.lifecycleGeneration') = 'text'
                  THEN ':' || json_extract(event_json, '$.lifecycleGeneration') ELSE '' END AS session_id
              FROM provider_runtime_events
              WHERE event_id = ranked.activity_id AND thread_id = ranked.thread_id
                AND ranked.kind = 'context-window.updated'
                AND json_extract(event_json, '$.provider') = 'codex'
            )
          ), ranked.payload_json) AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM (
          SELECT
            thread_id,
            activity_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS activity_rank
          FROM projection_thread_activities
          WHERE ${liveThreadScope}
        ) AS ranks
        JOIN projection_thread_activities AS ranked USING (thread_id, activity_id)
        WHERE activity_rank <= ${MAX_SNAPSHOT_THREAD_ACTIVITIES}
          OR kind = ${VISUAL_REPLY_ACTIVITY_KIND}
          OR (${failedTurnTerminalActivity("ranked")})
          OR (
            kind IN ('approval.requested', 'user-input.requested')
            AND json_extract(payload_json, '$.requestId') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM projection_thread_activities AS later
              WHERE later.thread_id = ranked.thread_id
                AND json_extract(later.payload_json, '$.requestId') =
                  json_extract(ranked.payload_json, '$.requestId')
                AND (
                  (ranked.kind = 'approval.requested' AND later.kind = 'approval.resolved')
                  OR (
                    ranked.kind = 'approval.requested'
                    AND later.kind = 'provider.approval.respond.failed'
                    AND (
                      lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                        '%stale pending approval request%'
                      OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                        '%unknown pending approval request%'
                      OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                        '%unknown pending permission request%'
                    )
                  )
                  OR (ranked.kind = 'user-input.requested' AND later.kind = 'user-input.resolved')
                  OR (
                    ranked.kind = 'user-input.requested'
                    AND later.kind = 'provider.user-input.respond.failed'
                    AND (
                      lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                        '%stale pending user-input request%'
                      OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                        '%unknown pending user-input request%'
                    )
                  )
                )
                AND (
                  CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END >
                    CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                  OR (
                    CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                      CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                    AND COALESCE(later.sequence, -1) > COALESCE(ranked.sequence, -1)
                  )
                  OR (
                    CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                      CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                    AND COALESCE(later.sequence, -1) = COALESCE(ranked.sequence, -1)
                    AND later.created_at > ranked.created_at
                  )
                  OR (
                    CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                      CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                    AND COALESCE(later.sequence, -1) = COALESCE(ranked.sequence, -1)
                    AND later.created_at = ranked.created_at
                    AND later.activity_id > ranked.activity_id
                  )
                )
            )
          )
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listCheckpointRevertLifecycleActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM (
          SELECT
            thread_id,
            activity_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS activity_rank
          FROM projection_thread_activities
          WHERE kind IN (
            'checkpoint.revert.started',
            'checkpoint.revert.succeeded',
            'checkpoint.revert.failed'
          )
        ) AS ranks
        JOIN projection_thread_activities AS ranked USING (thread_id, activity_id)
        WHERE activity_rank = 1
        ORDER BY thread_id ASC
      `,
  });

  const listPendingInteractionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: OrchestrationPendingInteraction,
    execute: () => sql`
      SELECT
        interaction_kind AS "interactionKind",
        request_id AS "requestId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        lifecycle_generation AS "lifecycleGeneration",
        status,
        decision,
        response_command_id AS "responseCommandId",
        response_requested_at AS "responseRequestedAt",
        created_at AS "createdAt",
        resolved_at AS "resolvedAt"
      FROM projection_pending_interactions
      WHERE status <> 'confirmed'
      ORDER BY thread_id ASC, created_at ASC, interaction_kind ASC, request_id ASC
    `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          COALESCE(completed_at, started_at, requested_at) AS "completedAt"
        FROM projection_turns
        -- Provider-diff placeholders can reserve checkpoint metadata before the
        -- turn is complete; snapshot checkpoint summaries require completedAt.
        WHERE checkpoint_turn_count IS NOT NULL
          AND completed_at IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          latest.thread_id AS "threadId",
          latest.turn_id AS "turnId",
          latest.state,
          latest.requested_at AS "requestedAt",
          latest.started_at AS "startedAt",
          latest.completed_at AS "completedAt",
          latest.assistant_message_id AS "assistantMessageId",
          (
            SELECT MAX(MAX(
              requested_at,
              COALESCE(started_at, requested_at),
              COALESCE(completed_at, requested_at)
            ))
            FROM projection_turns
            WHERE turn_id IS NOT NULL
          ) AS "historyUpdatedAt"
        FROM projection_threads AS threads
        JOIN projection_turns AS latest ON latest.row_id = (
          SELECT row_id
          FROM projection_turns
          WHERE thread_id = threads.thread_id AND turn_id IS NOT NULL
          ORDER BY requested_at DESC, turn_id DESC
          LIMIT 1
        )
        ORDER BY latest.thread_id ASC
      `,
  });

  const listThreadActivityRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        WITH failed_turns AS MATERIALIZED (
          SELECT DISTINCT thread_id, turn_id
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
            AND turn_id IS NOT NULL
            AND (${turnFailureActivity})
        ),
        ranked AS (
          SELECT
            thread_id,
            activity_id,
            turn_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS activity_rank
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
        ),
        cutoff_turn AS (
          SELECT turn_id AS cutoff_turn_id
          FROM ranked
          WHERE activity_rank = ${MAX_THREAD_DETAIL_ACTIVITIES}
        ),
        cutoff_turn_state AS (
          SELECT
            cutoff_turn_id,
            EXISTS (
              SELECT 1
              FROM ranked
              WHERE activity_rank > ${MAX_THREAD_DETAIL_ACTIVITIES}
                AND turn_id = cutoff_turn_id
            ) AS is_split,
            EXISTS (
              SELECT 1
              FROM ranked
              WHERE activity_rank < ${MAX_THREAD_DETAIL_ACTIVITIES}
                AND turn_id IS NOT cutoff_turn_id
            ) AS has_newer_turn
          FROM cutoff_turn
        )
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          ranked.turn_id AS "turnId",
          tone,
          kind,
          summary,
          COALESCE((
            SELECT CASE WHEN json_type(totals, '$.inputTokens') = 'integer'
              AND json_type(totals, '$.outputTokens') = 'integer'
              THEN json_patch(activity.payload_json, json_object(
                'cumulativeUsage', json_object(
                  'inputTokens', json_extract(totals, '$.inputTokens'),
                  'outputTokens', json_extract(totals, '$.outputTokens'),
                  'cachedInputTokens', json_extract(totals, '$.cachedInputTokens'),
                  'cacheCreationInputTokens', json_extract(totals, '$.cacheWriteInputTokens')
                ),
                'usageSessionId', session_id
              )) END
            FROM (
              SELECT json_extract(event_json, '$.raw.payload.tokenUsage.total') AS totals,
                json_extract(event_json, '$.providerRefs.providerThreadId') ||
                CASE WHEN json_type(event_json, '$.lifecycleGeneration') = 'text'
                  THEN ':' || json_extract(event_json, '$.lifecycleGeneration') ELSE '' END AS session_id
              FROM provider_runtime_events
              WHERE event_id = ranked.activity_id AND thread_id = ranked.thread_id
                AND activity.kind = 'context-window.updated'
                AND json_extract(event_json, '$.provider') = 'codex'
            )
          ), activity.payload_json) AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM ranked
        JOIN projection_thread_activities AS activity USING (thread_id, activity_id)
        WHERE thread_id = ${threadId}
          AND (
            (
              activity_rank <= ${MAX_THREAD_DETAIL_ACTIVITIES}
              -- Drop a split oldest turn instead of extending the query beyond
              -- its cap. If one turn fills the entire window, retain the raw
              -- capped tail so an oversized turn does not hide all activity.
              AND NOT (
                EXISTS (SELECT 1 FROM cutoff_turn_state)
                AND (SELECT cutoff_turn_id FROM cutoff_turn_state) IS NOT NULL
                AND ranked.turn_id IS NOT NULL
                AND ranked.turn_id = (SELECT cutoff_turn_id FROM cutoff_turn_state)
                AND (SELECT is_split FROM cutoff_turn_state)
                AND (SELECT has_newer_turn FROM cutoff_turn_state)
              )
            )
            OR activity.kind = ${VISUAL_REPLY_ACTIVITY_KIND}
            OR (${failedTurnTerminalActivity("activity")})
            OR (
              kind IN ('approval.requested', 'user-input.requested')
              AND json_extract(payload_json, '$.requestId') IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM projection_thread_activities AS later
                WHERE later.thread_id = ranked.thread_id
                  AND json_extract(later.payload_json, '$.requestId') =
                    json_extract(activity.payload_json, '$.requestId')
                  AND (
                    (activity.kind = 'approval.requested' AND later.kind = 'approval.resolved')
                    OR (
                      activity.kind = 'approval.requested'
                      AND later.kind = 'provider.approval.respond.failed'
                      AND (
                        lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%stale pending approval request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending approval request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending permission request%'
                      )
                    )
                    OR (activity.kind = 'user-input.requested' AND later.kind = 'user-input.resolved')
                    OR (
                      activity.kind = 'user-input.requested'
                      AND later.kind = 'provider.user-input.respond.failed'
                      AND (
                        lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%stale pending user-input request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending user-input request%'
                      )
                    )
                  )
                  AND (
                    CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END >
                      CASE WHEN activity.sequence IS NULL THEN 0 ELSE 1 END
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN activity.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) > COALESCE(activity.sequence, -1)
                    )
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN activity.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) = COALESCE(activity.sequence, -1)
                      AND later.created_at > activity.created_at
                    )
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN activity.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) = COALESCE(activity.sequence, -1)
                      AND later.created_at = activity.created_at
                      AND later.activity_id > ranked.activity_id
                    )
                  )
              )
            )
          )
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listPendingInteractionRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: OrchestrationPendingInteraction,
    execute: ({ threadId }) => sql`
      SELECT
        interaction_kind AS "interactionKind",
        request_id AS "requestId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        lifecycle_generation AS "lifecycleGeneration",
        status,
        decision,
        response_command_id AS "responseCommandId",
        response_requested_at AS "responseRequestedAt",
        created_at AS "createdAt",
        resolved_at AS "resolvedAt"
      FROM projection_pending_interactions
      WHERE thread_id = ${threadId}
        AND status <> 'confirmed'
      ORDER BY created_at ASC, interaction_kind ASC, request_id ASC
    `,
  });

  const getThreadSessionRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const getLatestTurnRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
        ORDER BY requested_at DESC, turn_id DESC
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          COALESCE(completed_at, started_at, requested_at) AS "completedAt"
        FROM projection_turns
        -- Keep incomplete provider-diff placeholders out of the public
        -- checkpoint summary contract, which requires completedAt.
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
          AND completed_at IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const listGeneratedImageActivityRowsByTurn = SqlSchema.findAll({
    Request: ThreadTurnLookupInput,
    Result: ProjectionGeneratedImageActivityDbRowSchema,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT kind, payload_json AS "payload"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
          AND kind = 'tool.completed'
          AND json_extract(payload_json, '$.itemType') = 'image_generation'
        -- Provider replay can project the same completion more than once. Collapse
        -- exact payload duplicates before applying the two-records-per-image cap.
        GROUP BY kind, payload_json
        ORDER BY MIN(created_at) ASC, MIN(activity_id) ASC
        LIMIT ${MAX_TURN_GENERATED_IMAGE_ACTIVITY_RECORDS}
      `,
  });
  return {
    listThreadActivityRows,
    listPendingInteractionRows,
    listThreadSessionRows,
    listCheckpointRows,
    listLatestTurnRows,
    listCheckpointRevertLifecycleActivityRows,
    listCheckpointRowsByThread,
    listGeneratedImageActivityRowsByTurn,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,

    listThreadActivityRowsByThread,
    listPendingInteractionRowsByThread,
  };
}
