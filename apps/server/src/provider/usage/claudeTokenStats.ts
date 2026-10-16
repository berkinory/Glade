import type * as SqlClient from "effect/unstable/sql/SqlClient";

// Claude turn results and what each one counts. Model attribution is left to
// claudeTokenActivityCtes, so readers that only need the accounting skip the turn model lookup.
export function claudeResultCtes(sql: SqlClient.SqlClient, scope?: { readonly threadId: string }) {
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
        pm.dispatch_origin,
        ROW_NUMBER() OVER (
          PARTITION BY a.thread_id, a.turn_id
          ORDER BY a.sequence DESC, a.created_at DESC, a.activity_id DESC
        ) AS rank
      FROM claude_completed_source a
      JOIN projection_threads th ON th.thread_id = a.thread_id
      LEFT JOIN projection_turns pt ON pt.thread_id = a.thread_id AND pt.turn_id = a.turn_id
      LEFT JOIN projection_thread_messages pm
        ON pm.thread_id = pt.thread_id AND pm.message_id = pt.pending_message_id
      LEFT JOIN (
        SELECT thread_id, MIN(sequence) AS sequence
        FROM projection_thread_activities
        WHERE thread_id IN (SELECT thread_id FROM claude_completed_source)
        GROUP BY thread_id
      ) child_start ON child_start.thread_id = th.thread_id
      -- Provider-native children mirror usage that the parent's results include,
      -- but a stopped parent turn has no result usage. A parent result breakdown
      -- spans everything its process did since the previous result, so a child
      -- is covered by its source turn's breakdown or by any parent breakdown
      -- after the child started, before the parent's process changed. Purging the
      -- parent archives that uncovered usage with the parent, so a child of a
      -- purged parent no longer counts. Other child threads are independent work
      -- and always count.
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
              AND parent.kind = 'turn.completed'
              AND json_valid(parent.payload_json)
              AND json_extract(parent.payload_json, '$.tokenAccountingVersion') = 1
              AND json_type(parent.payload_json, '$.modelUsage') = 'object'
              AND (
                parent.turn_id = th.source_turn_id
                OR (
                  parent.sequence > child_start.sequence
                  AND NOT EXISTS (
                    SELECT 1 FROM projection_thread_activities boundary
                    WHERE boundary.thread_id = parent.thread_id
                      AND boundary.kind = 'background-work.reset'
                      AND boundary.sequence BETWEEN child_start.sequence AND parent.sequence
                  )
                )
              )
          )
        )
      )
        -- Claude results carry their provider in every supported database.
        AND COALESCE(
          json_extract(a.payload_json, '$.provider'),
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
        END AS main_tokens,
        CASE WHEN json_type(payload_json, '$.totalCostUsd') IN ('integer', 'real')
          THEN json_extract(payload_json, '$.totalCostUsd') END AS cost_usd
      FROM claude_completed_ranked c
    ),
    claude_model_usage_entries AS (
      SELECT c.activity_id, c.thread_id, c.turn_id, c.created_at,
        m.key AS model,
        CASE WHEN json_valid(m.value) THEN
          CASE WHEN json_type(m.value) = 'object' THEN m.value ELSE '{}' END
        ELSE '{}' END AS usage
      FROM claude_turn_results c, json_each(c.models) m
    ),
    claude_model_token_candidates AS (
      SELECT activity_id, thread_id, turn_id, created_at,
        NULLIF(TRIM(CAST(model AS TEXT)), '') AS model,
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
    -- Every Claude process start projects a background-work.reset (so does an exit), so these
    -- numbers separate a thread's results by process.
    claude_result_processes AS (
      SELECT activity_id, process
      FROM (
        SELECT activity_id, starts_process,
          SUM(starts_process) OVER (
            PARTITION BY thread_id ORDER BY sequence, created_at, activity_id
          ) AS process
        FROM (
          SELECT thread_id, sequence, created_at, activity_id, 0 AS starts_process
          FROM claude_turn_results
          UNION ALL
          SELECT b.thread_id, b.sequence, b.created_at, b.activity_id, 1
          FROM projection_thread_activities b
          WHERE b.kind = 'background-work.reset'
            AND b.thread_id IN (SELECT thread_id FROM claude_turn_results)
        )
      )
      WHERE starts_process = 0
    ),
    claude_result_usage AS (
      SELECT r.thread_id, r.activity_id, r.restored_usage_excluded, r.cost_usd, p.process,
        COALESCE(m.tokens, 0) AS model_tokens,
        COALESCE(r.main_tokens, 0) AS main_tokens,
        ROW_NUMBER() OVER (
          PARTITION BY r.thread_id ORDER BY r.sequence, r.created_at, r.activity_id
        ) AS position
      FROM claude_turn_results r
      JOIN claude_result_processes p ON p.activity_id = r.activity_id
      LEFT JOIN (
        SELECT activity_id, SUM(tokens) AS tokens FROM claude_model_token_rows GROUP BY activity_id
      ) m ON m.activity_id = r.activity_id
    ),
    claude_process_results AS (
      SELECT u.*,
        MIN(CASE WHEN model_tokens > 0 THEN position END) OVER process AS first_breakdown,
        MAX(CASE WHEN model_tokens > 0 THEN position END) OVER process AS last_breakdown,
        MAX(CASE WHEN model_tokens > 0 THEN process END) OVER (
          PARTITION BY thread_id ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS previous_breakdown_process
      FROM claude_result_usage u
      WINDOW process AS (PARTITION BY thread_id, process)
    ),
    -- A result breakdown is the process's cumulative usage minus that of its previous result, so
    -- a turn without a breakdown is inside the next breakdown of its process. When the process
    -- ends first, its usage reaches Claude Code's saved session totals instead, measured here by
    -- the main loop. A resumed process restores those totals into its first result, so a process's
    -- restorable usage is its breakdowns plus the main loops of turns after its last breakdown.
    claude_restorable_results AS (
      SELECT c.*,
        COALESCE(SUM(
          model_tokens
          + CASE WHEN model_tokens = 0 AND COALESCE(position > last_breakdown, 1)
            THEN main_tokens ELSE 0 END
        ) OVER earlier, 0) AS restorable_before,
        COALESCE(SUM(cost_usd) OVER earlier, 0) AS cost_before
      FROM claude_process_results c
      WINDOW earlier AS (
        PARTITION BY thread_id ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      )
    ),
    -- Results written before the adapter withheld restored totals (no restoredUsageExcluded) still
    -- carry them in a process's first breakdown. That result restored the previous breakdown
    -- process when its usage beyond its own main loop covers that process's restorable usage. It
    -- then counts everything beyond the restored usage, which is its own turn plus what the
    -- previous process did after its last breakdown beyond those main loops (a background subagent
    -- that outlived the result, an interrupted turn's subagents). Its cost likewise drops the
    -- recorded cost of the restored results. On real data restores exceeded the restorable usage
    -- by at most 3.4%, and no other first breakdown reached the previous process's usage at all.
    claude_restored_results AS (
      SELECT k.activity_id,
        k.restorable_before - j.restorable_before AS restored_tokens,
        CASE WHEN k.cost_usd IS NOT NULL
          THEN MAX(k.cost_usd - (k.cost_before - j.cost_before), 0) END AS own_cost_usd
      FROM claude_restorable_results k
      JOIN claude_restorable_results j
        ON j.thread_id = k.thread_id
        AND j.process = k.previous_breakdown_process
        AND j.position = j.first_breakdown
      WHERE k.position = k.first_breakdown
        AND NOT k.restored_usage_excluded
        AND k.restorable_before > j.restorable_before
        AND k.model_tokens - k.main_tokens
          BETWEEN k.restorable_before - j.restorable_before
          AND (k.restorable_before - j.restorable_before) * 21 / 20
    ),
    -- Every breakdown is a disjoint delta, so a failed result followed by later results of the
    -- same turn is still spend. A turn's main loop without a breakdown is measured from the turn's
    -- start, so only its latest completion counts, and only when no later breakdown covers it.
    claude_completed AS (
      SELECT r.*, u.model_tokens, restored.restored_tokens,
        COALESCE(u.last_breakdown > u.position, 0) AS covered_by_later_breakdown
      FROM claude_turn_results r
      JOIN claude_process_results u ON u.activity_id = r.activity_id
      LEFT JOIN claude_restored_results restored ON restored.activity_id = r.activity_id
      WHERE r.dispatch_origin IS NULL OR r.dispatch_origin = 'user'
    )
  `;
}

// Requires a turn_model CTE for the turn's selected model.
export function claudeTokenActivityCtes(
  sql: SqlClient.SqlClient,
  scope?: { readonly threadId: string },
) {
  return sql`
    ${claudeResultCtes(sql, scope)},
    claude_token_rows AS (
      SELECT c.thread_id, c.created_at, COALESCE(c.model, tm.model, 'unknown') AS model, c.tokens
      FROM (
        SELECT m.thread_id, m.turn_id, m.created_at, m.model, m.tokens
        FROM claude_model_token_rows m
        JOIN claude_completed c ON c.activity_id = m.activity_id
        WHERE c.restored_tokens IS NULL
        UNION ALL
        SELECT thread_id, turn_id, created_at, NULL, model_tokens - restored_tokens
        FROM claude_completed
        WHERE model_tokens > restored_tokens
        UNION ALL
        SELECT thread_id, turn_id, created_at, NULL, main_tokens
        FROM claude_completed
        WHERE model_tokens = 0 AND rank = 1 AND main_tokens > 0 AND NOT covered_by_later_breakdown
      ) c
      LEFT JOIN turn_model tm ON tm.thread_id = c.thread_id AND tm.turn_id = c.turn_id
    )
  `;
}
