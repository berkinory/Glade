import type * as SqlClient from "effect/unstable/sql/SqlClient";

export function claudeTokenActivityCtes(
  sql: SqlClient.SqlClient,
  scope?: { readonly threadId: string },
) {
  return sql`
    claude_completed_source AS (
      SELECT
        a.thread_id,
        a.turn_id,
        a.activity_id,
        a.sequence,
        a.created_at,
        CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END AS payload_json
      FROM projection_thread_activities a
      WHERE a.kind = 'turn.completed' AND a.turn_id IS NOT NULL
        ${scope ? sql`AND a.thread_id = ${scope.threadId}` : sql.literal("")}
    ),
    claude_completed_ranked AS (
      SELECT a.thread_id, a.turn_id, a.activity_id, a.sequence, a.created_at, a.payload_json,
        COALESCE(tm.model, 'unknown') AS model,
        pm.dispatch_origin,
        ROW_NUMBER() OVER (
          PARTITION BY a.thread_id, a.turn_id
          ORDER BY a.sequence DESC, a.created_at DESC, a.activity_id DESC
        ) AS rank
      FROM claude_completed_source a
      JOIN projection_threads th ON th.thread_id = a.thread_id
      LEFT JOIN turn_model tm ON tm.thread_id = a.thread_id AND tm.turn_id = a.turn_id
      LEFT JOIN projection_turns pt ON pt.thread_id = a.thread_id AND pt.turn_id = a.turn_id
      LEFT JOIN projection_thread_messages pm
        ON pm.thread_id = pt.thread_id AND pm.message_id = pt.pending_message_id
      -- Provider-native children mirror usage that the parent's turn result
      -- includes, but a stopped parent turn has no result usage. Count a child
      -- unless its source turn has a versioned result breakdown that covers it.
      -- Purging the parent archives that uncovered usage with the parent, so a
      -- child of a purged parent no longer counts. Other child threads are
      -- independent work and always count.
      WHERE (
        COALESCE(th.creation_source, '') != 'provider_native'
        OR (
          EXISTS (
            SELECT 1 FROM projection_threads parent_thread
            WHERE parent_thread.thread_id = th.parent_thread_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM projection_thread_activities parent
            WHERE parent.thread_id = th.parent_thread_id
              AND parent.turn_id = th.source_turn_id
              AND parent.kind = 'turn.completed'
              AND json_valid(parent.payload_json)
              AND json_extract(parent.payload_json, '$.tokenAccountingVersion') = 1
              AND json_type(parent.payload_json, '$.modelUsage') = 'object'
          )
        )
      )
        AND COALESCE(
          json_extract(a.payload_json, '$.provider'), tm.provider,
          CASE WHEN json_valid(th.model_selection_json)
            THEN json_extract(th.model_selection_json, '$.provider') END
        ) = 'claudeAgent'
    ),
    claude_turn_results AS (
      SELECT c.*,
        json_extract(payload_json, '$.restoredUsageExcluded') IS 1 AS restored_usage_excluded,
        CASE WHEN json_extract(payload_json, '$.tokenAccountingVersion') = 1
          AND json_type(payload_json, '$.modelUsage') = 'object'
          THEN json_extract(payload_json, '$.modelUsage') END AS models,
        CASE WHEN json_extract(payload_json, '$.tokenAccountingVersion') = 1
          AND json_type(payload_json, '$.mainLoopTokens') IN ('integer', 'real')
          AND json_extract(payload_json, '$.mainLoopTokens') >= 0
          THEN CAST(json_extract(payload_json, '$.mainLoopTokens') AS INTEGER)
        END AS main_tokens
      FROM claude_completed_ranked c
    ),
    claude_model_usage_entries AS (
      SELECT c.activity_id, c.thread_id, c.turn_id, c.created_at, c.model AS fallback_model,
        m.key AS model,
        CASE WHEN json_valid(m.value) THEN
          CASE WHEN json_type(m.value) = 'object' THEN m.value ELSE '{}' END
        ELSE '{}' END AS usage
      FROM claude_turn_results c, json_each(c.models) m
    ),
    claude_model_token_candidates AS (
      SELECT activity_id, thread_id, turn_id, created_at,
        COALESCE(NULLIF(TRIM(CAST(model AS TEXT)), ''), fallback_model) AS model,
        CAST(
          CASE
            -- Private builds of this PR briefly stored a compact form whose
            -- inputTokens already included cache reads/writes. Its explicit
            -- total is authoritative so those cache subsets are not added twice.
            WHEN json_type(usage, '$.totalTokens') IN ('integer', 'real')
              AND json_extract(usage, '$.totalTokens') > 0
            THEN json_extract(usage, '$.totalTokens')
            -- The SDK modelUsage shape has no totalTokens. Its inputTokens is
            -- uncached input, so all four disjoint counters form the total.
            ELSE
              CASE WHEN json_type(usage, '$.inputTokens') IN ('integer', 'real')
                AND json_extract(usage, '$.inputTokens') >= 0
                THEN json_extract(usage, '$.inputTokens') ELSE 0 END
              + CASE WHEN json_type(usage, '$.cacheReadInputTokens') IN ('integer', 'real')
                AND json_extract(usage, '$.cacheReadInputTokens') >= 0
                THEN json_extract(usage, '$.cacheReadInputTokens') ELSE 0 END
              + CASE WHEN json_type(usage, '$.cacheCreationInputTokens') IN ('integer', 'real')
                AND json_extract(usage, '$.cacheCreationInputTokens') >= 0
                THEN json_extract(usage, '$.cacheCreationInputTokens') ELSE 0 END
              + CASE WHEN json_type(usage, '$.outputTokens') IN ('integer', 'real')
                AND json_extract(usage, '$.outputTokens') >= 0
                THEN json_extract(usage, '$.outputTokens') ELSE 0 END
          END AS INTEGER
        ) AS tokens
      FROM claude_model_usage_entries
    ),
    claude_model_token_rows AS (
      SELECT activity_id, thread_id, turn_id, created_at, model, tokens
      FROM claude_model_token_candidates
      WHERE tokens > 0
    ),
    -- Claude Code restores a resumed session's saved totals into the first result of a new
    -- process. Results written before the adapter withheld that result (no restoredUsageExcluded)
    -- still carry it, and nothing stored marks a process start. Such a result's usage beyond its
    -- own main loop then matches the recorded usage of the results right before it, the previous
    -- process, so the turn counts its main loop instead. A turn without a result breakdown adds
    -- its usage to the next result of its process, or to the restored totals when its process
    -- ended, so a span is checked both with and without those turns' main loops. On real data
    -- restored results matched exactly or within 0.15% (turn work beyond the main loop), while
    -- the nearest coincidental span of an ordinary result was 0.5% away, hence 0.25%.
    claude_result_usage AS (
      SELECT r.thread_id, r.activity_id, r.restored_usage_excluded,
        COALESCE(m.tokens, 0) AS model_tokens,
        COALESCE(r.main_tokens, 0) AS main_tokens,
        ROW_NUMBER() OVER ordered AS position,
        COALESCE(SUM(COALESCE(m.tokens, 0)) OVER earlier, 0) AS recorded_before,
        COALESCE(SUM(COALESCE(m.tokens, r.main_tokens, 0)) OVER earlier, 0) AS observed_before
      FROM claude_turn_results r
      LEFT JOIN (
        SELECT activity_id, SUM(tokens) AS tokens FROM claude_model_token_rows GROUP BY activity_id
      ) m ON m.activity_id = r.activity_id
      WINDOW ordered AS (PARTITION BY r.thread_id ORDER BY r.sequence, r.created_at, r.activity_id),
        earlier AS (ordered ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ),
    claude_restored_results AS (
      SELECT DISTINCT activity_id
      FROM (
        SELECT k.activity_id, k.model_tokens - k.main_tokens AS excess,
          k.recorded_before - i.recorded_before AS recorded_span,
          k.observed_before - i.observed_before AS observed_span
        FROM claude_result_usage k
        JOIN claude_result_usage i ON i.thread_id = k.thread_id AND i.position < k.position
        WHERE NOT k.restored_usage_excluded AND k.model_tokens > k.main_tokens
      )
      WHERE (recorded_span > 0 AND excess BETWEEN recorded_span AND recorded_span * 401 / 400)
        OR (observed_span > 0 AND excess BETWEEN observed_span AND observed_span * 401 / 400)
    ),
    claude_completed AS (
      SELECT r.*, restored.activity_id IS NOT NULL AS restored_totals
      FROM claude_turn_results r
      LEFT JOIN claude_restored_results restored ON restored.activity_id = r.activity_id
      WHERE r.rank = 1 AND (r.dispatch_origin IS NULL OR r.dispatch_origin = 'user')
    ),
    claude_token_rows AS (
      SELECT m.thread_id, m.created_at, m.model, m.tokens
      FROM claude_model_token_rows m
      JOIN claude_completed c ON c.activity_id = m.activity_id
      WHERE NOT c.restored_totals
      UNION ALL
      SELECT c.thread_id, c.created_at, c.model, CAST(c.main_tokens AS INTEGER) AS tokens
      FROM claude_completed c
      WHERE c.main_tokens > 0
        AND (
          c.restored_totals
          OR NOT EXISTS (
            SELECT 1 FROM claude_model_token_rows m WHERE m.activity_id = c.activity_id
          )
        )
    )
  `;
}
