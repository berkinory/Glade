import type {
  ProfileStats,
  StatsGetProfileStatsInput,
  StatsGetProfileTokenStatsInput,
  ProfileTokenStats,
} from "@glade/contracts/server/stats";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../../server/config";
import { claudeTokenActivityCtes } from "../../provider/usage/claudeTokenStats";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import nodePath from "node:path";
import {
  TokenDayRow,
  turnModelSelectionCte,
  DayCountRow,
  agentTurnSecondsCtes,
  sqliteModifierFromUtcOffsetMinutes,
  tokenUsageSessionIdSql,
  num,
} from "../profileQueryValues";
import {
  localToday,
  buildHeatmap,
  computeStreaks,
  normalizeProviderKind,
  percent1,
  sanitizeHandle,
  aggregateTokenActivity,
  dayCounts,
} from "../profileActivity";
import { ProfileStatsQueryShape, ProfileStatsQuery } from "../Services/ProfileStatsQuery";

const makeProfileStatsQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig;

  const queryPromptActivity = (tz: string) =>
    sql<DayCountRow>`
        WITH prompt_events AS (
          -- The thread join (no deleted_at filter) keeps archived and not-yet-
          -- purged rows counting while excluding orphan message rows of purged
          -- threads, which are already counted from the archive tables.
          SELECT m.created_at AS created_at
          FROM projection_thread_messages m
          JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE m.role = 'user'
            AND m.source = 'native'
            AND (m.dispatch_origin IS NULL OR m.dispatch_origin = 'user')
          UNION ALL
          SELECT d.created_at AS created_at
          FROM profile_stats_deleted_prompts d
        )
        SELECT
          STRFTIME('%Y-%m-%d', DATETIME(created_at, ${tz})) AS day,
          COUNT(*) AS count
        FROM prompt_events
        GROUP BY day
      `;

  const queryTokenActivity = (tz: string) =>
    sql<TokenDayRow>`
        WITH turn_model AS (
          ${turnModelSelectionCte(sql)}
        ),
        ${claudeTokenActivityCtes(sql)},
        token_activity AS (
          SELECT
            a.thread_id AS thread_id,
            STRFTIME('%Y-%m-%d', DATETIME(a.created_at, ${tz})) AS day,
            COALESCE(
              tm.provider,
              json_extract(a.payload_json, '$.provider'),
              CASE
                WHEN th.model_selection_json IS NOT NULL AND json_valid(th.model_selection_json)
                THEN json_extract(th.model_selection_json, '$.provider')
              END,
              'unknown'
            ) AS provider,
            COALESCE(tm.model, 'unknown') AS model,
            ${tokenUsageSessionIdSql(sql)} AS usage_session_id,
            CAST(json_extract(a.payload_json, '$.totalProcessedTokens') AS INTEGER) AS tp,
            CAST(json_extract(a.payload_json, '$.usedTokens') AS INTEGER) AS ut,
            pm.dispatch_origin AS dispatch_origin,
            a.sequence AS sequence,
            a.created_at AS created_at,
            a.activity_id AS activity_id
          FROM projection_thread_activities a
          JOIN projection_threads th ON th.thread_id = a.thread_id
          LEFT JOIN turn_model tm
            ON tm.thread_id = a.thread_id
           AND tm.turn_id = a.turn_id
          LEFT JOIN projection_turns pt
            ON pt.thread_id = a.thread_id
           AND pt.turn_id = a.turn_id
          LEFT JOIN projection_thread_messages pm
            ON pm.thread_id = pt.thread_id
           AND pm.message_id = pt.pending_message_id
          WHERE a.kind = 'context-window.updated'
            AND COALESCE(
              json_extract(a.payload_json, '$.totalProcessedTokens'),
              json_extract(a.payload_json, '$.usedTokens')
            ) IS NOT NULL
        ),
        -- Claude's verified per-turn results are counted separately below. Drop
        -- provisional/legacy Claude context rows before windowing so they cannot
        -- change a neighboring provider's cumulative or used-only delta.
        ev AS (
          SELECT * FROM token_activity WHERE provider != 'claudeAgent'
        ),
        provider_model_scale AS (
          SELECT thread_id, usage_session_id, provider, model, MAX(tp IS NOT NULL) AS has_cumulative
          FROM ev
          GROUP BY thread_id, usage_session_id, provider, model
        ),
        cumulative_kept AS (
          SELECT
            day,
            provider,
            model,
            thread_id,
            usage_session_id,
            tp AS tot,
            dispatch_origin,
            sequence,
            created_at,
            activity_id
          FROM ev
          WHERE tp IS NOT NULL
        ),
        cumulative_delta AS (
          SELECT
            day,
            provider,
            model,
            dispatch_origin,
            CASE
              WHEN previous_tot IS NULL OR tot < previous_tot THEN tot
              ELSE MAX(0, tot - previous_tot)
            END AS d
          FROM (
            SELECT
              day,
              provider,
              model,
              dispatch_origin,
              tot,
              LAG(tot) OVER (
                PARTITION BY thread_id, usage_session_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_tot
            FROM cumulative_kept
          )
        ),
        used_only_kept AS (
          SELECT
            ev.day AS day,
            ev.provider AS provider,
            ev.model AS model,
            ev.thread_id AS thread_id,
            ev.usage_session_id AS usage_session_id,
            ev.ut AS tot,
            ev.dispatch_origin AS dispatch_origin,
            ev.sequence AS sequence,
            ev.created_at AS created_at,
            ev.activity_id AS activity_id
          FROM ev
          JOIN provider_model_scale pms
            ON pms.thread_id = ev.thread_id
           AND pms.usage_session_id = ev.usage_session_id
           AND pms.provider = ev.provider
           AND pms.model = ev.model
          WHERE ev.tp IS NULL
            AND ev.ut IS NOT NULL
            AND NOT pms.has_cumulative
        ),
        used_only_delta AS (
          SELECT
            day,
            provider,
            model,
            dispatch_origin,
            CASE
              WHEN previous_tot IS NULL THEN tot
              WHEN tot < previous_tot
                AND (provider != previous_provider OR model != previous_model)
              THEN tot
              ELSE MAX(0, tot - previous_tot)
            END AS d
          FROM (
            SELECT
              day,
              provider,
              model,
              dispatch_origin,
              tot,
              LAG(tot) OVER (
                PARTITION BY thread_id, usage_session_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_tot,
              LAG(provider) OVER (
                PARTITION BY thread_id, usage_session_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_provider,
              LAG(model) OVER (
                PARTITION BY thread_id, usage_session_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_model
            FROM used_only_kept
          )
        ),
        all_tokens AS (
          SELECT day, provider, model, d FROM cumulative_delta
          WHERE dispatch_origin IS NULL OR dispatch_origin = 'user'
          UNION ALL
          SELECT day, provider, model, d FROM used_only_delta
          WHERE dispatch_origin IS NULL OR dispatch_origin = 'user'
          UNION ALL
          SELECT STRFTIME('%Y-%m-%d', DATETIME(created_at, ${tz})),
            'claudeAgent', model, tokens
          FROM claude_token_rows
          UNION ALL
          SELECT
            STRFTIME('%Y-%m-%d', DATETIME(a.created_at, ${tz})) AS day,
            COALESCE(a.provider, 'unknown') AS provider,
            COALESCE(a.model, 'unknown') AS model,
            a.tokens AS d
          FROM profile_stats_deleted_tokens a
          WHERE COALESCE(a.provider, 'unknown') != 'claudeAgent' OR a.token_accounting_version = 1
        )
        SELECT day, provider, model, SUM(d) AS tokens
        FROM all_tokens
        GROUP BY day, provider, model
      `;

  const queryThreadDays = (tz: string) =>
    sql<DayCountRow>`
        WITH started AS (
          SELECT created_at AS at
          FROM projection_threads
          WHERE COALESCE(creation_source, '') != 'provider_native'
          UNION ALL
          -- Chats purged before their start was archived count on the day they were deleted.
          SELECT COALESCE(created_at, deleted_at) FROM profile_stats_deleted_threads
        )
        SELECT STRFTIME('%Y-%m-%d', DATETIME(at, ${tz})) AS day, COUNT(*) AS count
        FROM started
        GROUP BY day
        ORDER BY day
      `;

  const queryAgentDays = (tz: string) =>
    sql<DayCountRow>`
        WITH ${agentTurnSecondsCtes(sql)},
        turns AS (
          SELECT started_at, seconds FROM agent_turn_seconds
          UNION ALL
          SELECT started_at, seconds FROM profile_stats_deleted_agent_turns
        )
        SELECT STRFTIME('%Y-%m-%d', DATETIME(started_at, ${tz})) AS day, SUM(seconds) AS count
        FROM turns
        GROUP BY day
        HAVING count > 0
        ORDER BY day
      `;

  // Providers that ran at least one turn, so the token view can name the ones that report no usage.
  const queryProvidersWithTurns = () =>
    sql<{ readonly provider: string | null }>`
        SELECT DISTINCT COALESCE(
          json_extract(e.payload_json, '$.modelSelection.provider'),
          CASE WHEN json_valid(t.model_selection_json)
            THEN json_extract(t.model_selection_json, '$.provider') END
        ) AS provider
        FROM orchestration_events e
        JOIN projection_threads t
          ON t.thread_id = COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id)
        WHERE e.event_type = 'thread.turn-start-requested'
      `;

  const getProfileStats = (
    input: StatsGetProfileStatsInput,
  ): Effect.Effect<ProfileStats, TaggedFailure> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const todayKey = localToday(input.utcOffsetMinutes);

      const promptActivityRows = yield* queryPromptActivity(tz);
      const threadDayRows = yield* queryThreadDays(tz);
      const agentDayRows = yield* queryAgentDays(tz);

      const countByDay = new Map<string, number>();
      for (const row of promptActivityRows) {
        const day = nonEmptyTrimmed(row.day) ?? null;
        if (day) {
          countByDay.set(day, (countByDay.get(day) ?? 0) + num(row.count));
        }
      }
      const activeDaysAsc = [...countByDay.entries()]
        .filter(([, count]) => count > 0)
        .map(([day]) => day)
        .toSorted();
      const { current: currentStreakDays, longest: longestStreakDays } = computeStreaks(
        activeDaysAsc,
        todayKey,
      );

      const homeDirBasename = nodePath.basename(config.homeDir) || "glade";

      return {
        generatedAt: new Date().toISOString(),
        timezone: { utcOffsetMinutes: input.utcOffsetMinutes, today: todayKey },
        identity: {
          homeDirBasename,
          defaultHandle: sanitizeHandle(homeDirBasename),
        },
        activity: {
          currentStreakDays,
          longestStreakDays,
          threadDays: dayCounts(threadDayRows),
          agentDays: dayCounts(agentDayRows),
          heatmapMetric: "prompts",
          heatmap: buildHeatmap(countByDay, todayKey),
        },
      } satisfies ProfileStats;
    });

  const getProfileTokenStats = (
    input: StatsGetProfileTokenStatsInput,
  ): Effect.Effect<ProfileTokenStats, TaggedFailure> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const todayKey = localToday(input.utcOffsetMinutes);
      const rows = yield* queryTokenActivity(tz);
      const providerRows = yield* queryProvidersWithTurns();
      const { tokensByDay, tokensByProvider, modelDays, lifetime } = aggregateTokenActivity(rows);

      let peakDay: string | null = null;
      let peakDayTokens: number | null = null;
      for (const [day, tokens] of tokensByDay) {
        if (peakDayTokens === null || tokens > peakDayTokens) {
          peakDayTokens = tokens;
          peakDay = day;
        }
      }

      const providers = [...tokensByProvider.entries()]
        .filter(([, tokens]) => tokens > 0)
        .toSorted((a, b) => b[1] - a[1])
        .map(([provider]) => provider);
      const available = lifetime > 0;

      const providersWithTurns = new Set<ProviderKind>();
      for (const row of providerRows) {
        const provider = normalizeProviderKind(row.provider);
        if (provider !== "unknown") {
          providersWithTurns.add(provider);
        }
      }
      const unavailableProviders = [...providersWithTurns]
        .filter((provider) => !tokensByProvider.has(provider))
        .toSorted();

      const totalProviderTokens = [...tokensByProvider.values()].reduce(
        (sum, tokens) => sum + tokens,
        0,
      );
      const topProvider = providers[0] ?? null;
      const topProviderPercent =
        topProvider && totalProviderTokens > 0
          ? percent1(tokensByProvider.get(topProvider) ?? 0, totalProviderTokens)
          : null;

      return {
        available,
        lifetimeTotalTokens: available ? lifetime : null,
        peakDayTokens,
        peakDay,
        providers,
        unavailableProviders,
        topProvider,
        topProviderPercent,
        modelDays,
        heatmapMetric: "tokens",
        heatmap: buildHeatmap(tokensByDay, todayKey),
      } satisfies ProfileTokenStats;
    });

  return { getProfileStats, getProfileTokenStats } satisfies ProfileStatsQueryShape;
});

export const ProfileStatsQueryLive = Layer.effect(ProfileStatsQuery, makeProfileStatsQuery);
