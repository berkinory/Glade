import type {
  ProfileStats,
  ProfileQuota,
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
  PromptActivityRow,
  TokenDayRow,
  turnModelSelectionCte,
  CountRow,
  TurnInsightRow,
  MostWorkedProjectRow,
  sqliteModifierFromUtcOffsetMinutes,
  num,
} from "../profileQueryValues";
import {
  SkillUsageMessageRow,
  ArchivedSkillUsageRow,
  aggregateProfileSkillUsageRows,
} from "../profileSkillUsage";
import {
  localToday,
  buildHeatmap,
  computeStreaks,
  formatHour,
  arcName,
  compareNullableText,
  normalizeProviderKind,
  normalizeUsageModel,
  percent1,
  deriveInitials,
  sanitizeHandle,
  buildMostWorkedProject,
  aggregateTokenActivity,
} from "../profileActivity";
import { ProfileStatsQueryShape, ProfileStatsQuery } from "../Services/ProfileStatsQuery";

const SKILL_RESULT_LIMIT = 12;

type ProviderModelUsage = ProfileStats["providerModels"][number];

function emptyQuota(): ProfileQuota {
  return {
    status: "unavailable",
    provider: null,
    window: null,
    usedPercent: null,
    resetsAt: null,
    planName: null,
  };
}

const makeProfileStatsQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig;

  const queryPromptActivity = (tz: string) =>
    sql<PromptActivityRow>`
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
          CAST(STRFTIME('%H', DATETIME(created_at, ${tz})) AS INTEGER) AS hour,
          COUNT(*) AS count
        FROM prompt_events
        GROUP BY day, hour
        ORDER BY day ASC, hour ASC
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
          SELECT thread_id, provider, model, MAX(tp IS NOT NULL) AS has_cumulative
          FROM ev
          GROUP BY thread_id, provider, model
        ),
        cumulative_kept AS (
          SELECT
            day,
            provider,
            model,
            thread_id,
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
                PARTITION BY thread_id
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
            ev.ut AS tot,
            ev.dispatch_origin AS dispatch_origin,
            ev.sequence AS sequence,
            ev.created_at AS created_at,
            ev.activity_id AS activity_id
          FROM ev
          JOIN provider_model_scale pms
            ON pms.thread_id = ev.thread_id
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
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_tot,
              LAG(provider) OVER (
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_provider,
              LAG(model) OVER (
                PARTITION BY thread_id
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

  const queryTotalThreads = () =>
    sql<CountRow>`
        SELECT
          (SELECT COUNT(*) FROM projection_threads)
          + (SELECT COUNT(*) FROM profile_stats_deleted_threads) AS count
      `;

  const queryTurnInsights = () =>
    sql<TurnInsightRow>`
        WITH turn_model AS (${turnModelSelectionCte(sql)}), per_turn AS (
          SELECT
            COALESCE(tm.provider, json_extract(e.payload_json, '$.modelSelection.provider'),
              CASE WHEN json_valid(t.model_selection_json)
                THEN json_extract(t.model_selection_json, '$.provider') END) AS provider,
            COALESCE(tm.model, json_extract(e.payload_json, '$.modelSelection.model'), 'unknown') AS model,
            CASE
              WHEN json_type(e.payload_json, '$.modelSelection') = 'object'
              THEN COALESCE(
                json_extract(e.payload_json, '$.modelSelection.options.reasoningEffort'),
                json_extract(e.payload_json, '$.modelSelection.options.effort')
              )
              ELSE CASE
                WHEN t.model_selection_json IS NOT NULL AND json_valid(t.model_selection_json)
                THEN COALESCE(
                  json_extract(t.model_selection_json, '$.options.reasoningEffort'),
                  json_extract(t.model_selection_json, '$.options.effort')
                )
              END
            END AS reasoning
          FROM orchestration_events e
          JOIN projection_threads t
            ON t.thread_id = COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id)
          LEFT JOIN projection_turns pt
            ON pt.thread_id = t.thread_id
           AND pt.pending_message_id = json_extract(e.payload_json, '$.messageId')
          LEFT JOIN turn_model tm ON tm.thread_id = pt.thread_id AND tm.turn_id = pt.turn_id
          LEFT JOIN projection_thread_messages um
            ON um.thread_id = COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id)
           AND um.message_id = json_extract(e.payload_json, '$.messageId')
          WHERE e.event_type = 'thread.turn-start-requested'
            AND (um.dispatch_origin IS NULL OR um.dispatch_origin = 'user')
        ),
        turn_counts AS (
          SELECT provider, model, reasoning, COUNT(*) AS count
          FROM per_turn
          GROUP BY provider, model, reasoning
          UNION ALL
          SELECT provider, model, reasoning, turn_count AS count
          FROM profile_stats_deleted_turns
        )
        SELECT provider, model, reasoning, SUM(count) AS count
        FROM turn_counts
        GROUP BY provider, model, reasoning
        ORDER BY count DESC, provider ASC, model ASC, reasoning ASC
      `;

  const querySkillUsageMessages = () =>
    sql<SkillUsageMessageRow>`
      SELECT
        m.message_id AS messageId,
        CASE
          WHEN m.text GLOB '*$[A-Za-z0-9]*'
            OR m.text GLOB '*/[A-Za-z0-9]*'
          THEN m.text
          ELSE NULL
        END AS text,
        m.skills_json AS skillsJson,
        m.mentions_json AS mentionsJson
      FROM projection_thread_messages m
      JOIN projection_threads t ON t.thread_id = m.thread_id
      WHERE m.role = 'user'
        AND m.source = 'native'
        AND (m.dispatch_origin IS NULL OR m.dispatch_origin = 'user')
        AND (
          (m.skills_json IS NOT NULL AND TRIM(m.skills_json) NOT IN ('', '[]'))
          OR (m.mentions_json IS NOT NULL AND TRIM(m.mentions_json) NOT IN ('', '[]'))
          OR m.text GLOB '*$[A-Za-z0-9]*'
          OR m.text GLOB '*/[A-Za-z0-9]*'
        )
      ORDER BY m.created_at ASC, m.message_id ASC
    `;

  const queryArchivedSkillUsage = () =>
    sql<ArchivedSkillUsageRow>`
        SELECT name, kind, run_count AS runCount
        FROM profile_stats_deleted_skills
      `;

  const queryMostWorkedProject = (tz: string) =>
    sql<MostWorkedProjectRow>`
        WITH project_prompts AS (
          SELECT
            t.project_id AS project_id,
            m.thread_id AS thread_id,
            m.created_at AS created_at
          FROM projection_thread_messages m
          JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE m.role = 'user'
            AND m.source = 'native'
            AND (m.dispatch_origin IS NULL OR m.dispatch_origin = 'user')
          UNION ALL
          SELECT
            d.project_id AS project_id,
            d.thread_id AS thread_id,
            d.created_at AS created_at
          FROM profile_stats_deleted_prompts d
        )
        SELECT
          p.project_id AS projectId,
          p.title AS title,
          p.workspace_root AS workspaceRoot,
          COUNT(*) AS promptCount,
          COUNT(DISTINCT e.thread_id) AS threadCount,
          COUNT(DISTINCT STRFTIME('%Y-%m-%d', DATETIME(e.created_at, ${tz}))) AS activeDays,
          MAX(e.created_at) AS lastWorkedAt
        FROM project_prompts e
        JOIN projection_projects p ON p.project_id = e.project_id
        GROUP BY p.project_id, p.title, p.workspace_root
        ORDER BY
          promptCount DESC,
          activeDays DESC,
          lastWorkedAt DESC,
          p.title ASC
        LIMIT 1
      `;

  const getProfileStats = (
    input: StatsGetProfileStatsInput,
  ): Effect.Effect<ProfileStats, TaggedFailure> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const todayKey = localToday(input.utcOffsetMinutes);

      const promptActivityRows = yield* queryPromptActivity(tz);
      const totalThreadRows = yield* queryTotalThreads();
      const turnInsightRows = yield* queryTurnInsights();
      const skillMessageRows = yield* querySkillUsageMessages();
      const archivedSkillRows = yield* queryArchivedSkillUsage();
      const mostWorkedProjectRows = yield* queryMostWorkedProject(tz);

      const countByDay = new Map<string, number>();
      const hourCounts = Array.from({ length: 24 }, () => 0);
      let totalPromptsSent = 0;
      for (const row of promptActivityRows) {
        const day = nonEmptyTrimmed(row.day) ?? null;
        const count = num(row.count);
        if (day) {
          countByDay.set(day, (countByDay.get(day) ?? 0) + count);
        }
        const hour = ((Math.trunc(num(row.hour)) % 24) + 24) % 24;
        hourCounts[hour] = (hourCounts[hour] ?? 0) + count;
        totalPromptsSent += count;
      }
      const heatmap = buildHeatmap(countByDay, todayKey);
      const activeDaysAsc = [...countByDay.entries()]
        .filter(([, count]) => count > 0)
        .map(([day]) => day)
        .toSorted();
      const { current: currentStreakDays, longest: longestStreakDays } = computeStreaks(
        activeDaysAsc,
        todayKey,
      );

      const totalHourTurns = hourCounts.reduce((sum, value) => sum + value, 0);
      let bestHour: number | null = null;
      let bestHourCount = 0;
      if (totalHourTurns > 0) {
        for (let hour = 0; hour < 24; hour += 1) {
          const hourCount = hourCounts[hour] ?? 0;
          if (hourCount > bestHourCount) {
            bestHourCount = hourCount;
            bestHour = hour;
          }
        }
      }
      const activeHours =
        bestHour === null
          ? { startHour: null, endHour: null, turnCount: 0, label: null }
          : {
              startHour: bestHour,
              endHour: null,
              turnCount: bestHourCount,
              label: `${formatHour(bestHour)} · ${arcName(bestHour)}`,
            };

      const providerModelCounts = new Map<
        string,
        { readonly provider: string | null; readonly model: string | null; count: number }
      >();
      const reasoningCounts = new Map<string, { readonly reasoning: string; count: number }>();

      for (const row of turnInsightRows) {
        const count = num(row.count);
        const provider = normalizeProviderKind(row.provider);
        const model = normalizeUsageModel(row.model, provider);
        const providerModelKey = `${provider ?? ""}\u0000${model ?? ""}`;
        const existingProviderModel = providerModelCounts.get(providerModelKey);
        if (existingProviderModel) {
          existingProviderModel.count += count;
        } else {
          providerModelCounts.set(providerModelKey, { provider, model, count });
        }

        const reasoning = nonEmptyTrimmed(row.reasoning) ?? null;
        if (reasoning) {
          const existingReasoning = reasoningCounts.get(reasoning);
          if (existingReasoning) {
            existingReasoning.count += count;
          } else {
            reasoningCounts.set(reasoning, { reasoning, count });
          }
        }
      }

      const providerModelRows = [...providerModelCounts.values()].toSorted(
        (left, right) =>
          right.count - left.count ||
          compareNullableText(left.provider, right.provider) ||
          compareNullableText(left.model, right.model),
      );
      const totalModelTurns = providerModelRows.reduce((sum, row) => sum + num(row.count), 0);
      const providerModels: ProviderModelUsage[] = providerModelRows.slice(0, 8).map((row) => {
        const count = num(row.count);
        return {
          provider: normalizeProviderKind(row.provider),
          model: nonEmptyTrimmed(row.model) ?? "unknown",
          turnCount: count,
          percent: percent1(count, totalModelTurns),
        };
      });

      const providerTurnCounts = new Map<ProviderKind, number>();

      for (const row of providerModelRows) {
        const provider = normalizeProviderKind(row.provider);
        if (provider === "unknown") {
          continue;
        }
        providerTurnCounts.set(provider, (providerTurnCounts.get(provider) ?? 0) + num(row.count));
      }
      const totalKnownProviderTurns = [...providerTurnCounts.values()].reduce(
        (sum, count) => sum + count,
        0,
      );
      let topProvider: ProviderKind | null = null;
      let topProviderTurns = 0;
      for (const [provider, count] of providerTurnCounts) {
        if (count > topProviderTurns) {
          topProvider = provider;
          topProviderTurns = count;
        }
      }

      const topProviderPercent =
        topProvider && totalKnownProviderTurns > 0
          ? percent1(topProviderTurns, totalKnownProviderTurns)
          : null;

      const reasoningRows = [...reasoningCounts.values()].toSorted(
        (left, right) =>
          right.count - left.count || compareNullableText(left.reasoning, right.reasoning),
      );
      const totalReasonedSelections = reasoningRows.reduce((sum, row) => sum + num(row.count), 0);
      const topReasoningRow = reasoningRows[0];
      const topReasoning = topReasoningRow?.reasoning ?? null;

      const topReasoningPercent =
        topReasoningRow && totalReasonedSelections > 0
          ? percent1(num(topReasoningRow.count), totalReasonedSelections)
          : null;

      const allSkillUsages = aggregateProfileSkillUsageRows(skillMessageRows, archivedSkillRows);
      const skills = allSkillUsages.slice(0, SKILL_RESULT_LIMIT);
      const totalSkillsUsed = allSkillUsages.reduce((sum, row) => sum + row.runCount, 0);

      const homeDirBasename = nodePath.basename(config.homeDir) || "glade";

      return {
        generatedAt: new Date().toISOString(),
        timezone: { utcOffsetMinutes: input.utcOffsetMinutes, today: todayKey },
        identity: {
          homeDirBasename,
          initials: deriveInitials(homeDirBasename),
          defaultHandle: sanitizeHandle(homeDirBasename),
        },
        activity: {
          currentStreakDays,
          longestStreakDays,
          totalPromptsSent,
          totalThreads: num(totalThreadRows[0]?.count),
          promptsToday: countByDay.get(todayKey) ?? 0,
          heatmapMetric: "prompts",
          heatmap,
        },
        activeHours,
        insights: {
          topProvider,
          topProviderPercent,
          topReasoning,
          topReasoningPercent,
          skillsExplored: allSkillUsages.length,
          totalSkillsUsed,
        },
        providerModels,
        skills,
        mostUsedSkill: skills[0] ?? null,
        mostWorkedProject: buildMostWorkedProject(mostWorkedProjectRows[0]),
        quota: emptyQuota(),
      } satisfies ProfileStats;
    });

  const getProfileTokenStats = (
    input: StatsGetProfileTokenStatsInput,
  ): Effect.Effect<ProfileTokenStats, TaggedFailure> =>
    Effect.gen(function* () {
      const tz = sqliteModifierFromUtcOffsetMinutes(input.utcOffsetMinutes);
      const todayKey = localToday(input.utcOffsetMinutes);
      const rows = yield* queryTokenActivity(tz);
      const turnInsightRows = yield* queryTurnInsights();
      const { tokensByDay, tokensByProvider, tokensByProviderModel, lifetime } =
        aggregateTokenActivity(rows);

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
      for (const row of turnInsightRows) {
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

      const models = [...tokensByProviderModel.values()]
        .filter((row) => row.tokens > 0)
        .toSorted(
          (left, right) =>
            right.tokens - left.tokens ||
            compareNullableText(left.provider, right.provider) ||
            compareNullableText(left.model, right.model),
        )
        .slice(0, 8)
        .map((row) => ({
          provider: row.provider,
          model: row.model,
          tokens: row.tokens,
          percent: percent1(row.tokens, lifetime),
        }));

      return {
        available,
        lifetimeTotalTokens: available ? lifetime : null,
        peakDayTokens,
        peakDay,
        providers,
        unavailableProviders,
        topProvider,
        topProviderPercent,
        models,
        heatmapMetric: "tokens",
        heatmap: buildHeatmap(tokensByDay, todayKey),
      } satisfies ProfileTokenStats;
    });

  return { getProfileStats, getProfileTokenStats } satisfies ProfileStatsQueryShape;
});

export const ProfileStatsQueryLive = Layer.effect(ProfileStatsQuery, makeProfileStatsQuery);
