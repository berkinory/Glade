import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect } from "vitest";
import { CheckpointStoreLive } from "../../checkpointing/Layers/CheckpointStore";
import { GitCoreLive } from "../../git/Layers/GitCore";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { ServerConfig } from "../../server/config";
import { ProfileStatsArchive, ProfileStatsArchiveLive } from "../profileStatsArchive";
import { ProfileStatsQuery } from "../Services/ProfileStatsQuery";
import { ProfileStatsQueryLive } from "./ProfileStatsQuery";

const config = ServerConfig.layerTest(process.cwd(), { prefix: "glade-profile-attribution-" });
const checkpoint = CheckpointStoreLive.pipe(Layer.provide(GitCoreLive));
const layer = Layer.mergeAll(ProfileStatsQueryLive, ProfileStatsArchiveLive).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(checkpoint),
  Layer.provide(config),
  Layer.provide(NodeServices.layer),
);
const date = "2026-09-30T12:00:00.000Z";

it.layer(layer)("historical profile attribution", (it) => {
  it.effect("preserves unknown and observed usage across model changes and chat purge", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const stats = yield* ProfileStatsQuery;
      const archive = yield* ProfileStatsArchive;
      yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('project', 'Profile fixture', '/nonexistent-profile-fixture', '[]', ${date}, ${date})`;
      for (const provider of ["codex", "claudeAgent"] as const) {
        yield* sql`INSERT INTO projection_threads
          (thread_id, project_id, title, model_selection_json, created_at, updated_at)
          VALUES (${provider}, 'project', 'Historical usage',
            ${JSON.stringify({ provider, model: "later-model" })}, ${date}, ${date})`;
        for (const [index, model] of [
          "provider-default",
          provider === "claudeAgent" ? "default" : "provider-default",
          "known-model",
          null,
        ].entries()) {
          const turnId = `${provider}-${index}`;
          const messageId = `${turnId}-message`;
          const selection = model === null ? undefined : { provider, model };
          yield* sql`INSERT INTO projection_thread_messages
            (thread_id, message_id, role, text, is_streaming, created_at, updated_at)
            VALUES (${provider}, ${messageId}, 'user', 'work', 0, ${date}, ${date})`;
          yield* sql`INSERT INTO projection_turns
            (thread_id, turn_id, pending_message_id, state, requested_at, checkpoint_files_json)
            VALUES (${provider}, ${turnId}, ${messageId}, 'completed', ${date}, '[]')`;
          yield* sql`INSERT INTO orchestration_events
            (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
             actor_kind, payload_json, metadata_json)
            VALUES (${turnId}, 'thread', ${provider}, ${index}, 'thread.turn-start-requested',
              ${date}, 'user', ${JSON.stringify({ threadId: provider, messageId, modelSelection: selection })}, '{}')`;
          if (index === 1) {
            yield* sql`INSERT INTO provider_runtime_events
              (event_id, thread_id, turn_id, event_type, event_json, persisted_at)
              VALUES (${turnId}, ${provider}, ${turnId}, 'turn.started',
                ${JSON.stringify({ provider, payload: { model: "observed-model" } })}, ${date})`;
          }
          const payload =
            provider === "codex"
              ? { provider, totalProcessedTokens: (index + 1) * 100 }
              : {
                  provider,
                  tokenAccountingVersion: 1,
                  mainLoopTokens: 100,
                  ...(index === 2 ? { modelUsage: { "known-model": { totalTokens: 100 } } } : {}),
                };
          yield* sql`INSERT INTO projection_thread_activities
            (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at)
            VALUES (${turnId}, ${provider}, ${turnId}, 'info',
              ${provider === "codex" ? "context-window.updated" : "turn.completed"},
              'usage', ${JSON.stringify(payload)}, ${index}, ${date})`;
        }
      }
      const input = { utcOffsetMinutes: 0 };
      const before = yield* stats.getProfileStats(input);
      const tokensBefore = yield* stats.getProfileTokenStats(input);
      expect(before.providerModels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ provider: "codex", model: "unknown", turnCount: 2 }),
          expect.objectContaining({ provider: "claudeAgent", model: "unknown", turnCount: 2 }),
          expect.objectContaining({ model: "observed-model", turnCount: 1 }),
          expect.objectContaining({ model: "known-model", turnCount: 1 }),
        ]),
      );
      expect(tokensBefore.lifetimeTotalTokens).toBe(800);
      expect(
        tokensBefore.models.filter((row) => row.model === "unknown").map((row) => row.tokens),
      ).toEqual([200, 200]);
      expect(tokensBefore.models.some((row) => row.model === "later-model")).toBe(false);
      for (const provider of ["codex", "claudeAgent"]) {
        yield* sql`UPDATE projection_threads SET model_selection_json =
          ${JSON.stringify({ provider, model: "another-later-model" })} WHERE thread_id = ${provider}`;
        yield* archive.purgeThreadWithStatsSnapshot({ threadId: provider });
      }
      const after = yield* stats.getProfileStats(input);
      const tokensAfter = yield* stats.getProfileTokenStats(input);
      expect(after.providerModels).toEqual(before.providerModels);
      expect(after.activity.totalPromptsSent).toBe(before.activity.totalPromptsSent);
      expect(tokensAfter.models).toEqual(tokensBefore.models);
      expect(tokensAfter.lifetimeTotalTokens).toBe(tokensBefore.lifetimeTotalTokens);
    }),
  );
});

const deleteOrders = [
  ["subagents before parent", ["child-stopped", "child-covered", "parent", "codex", "acp"]],
  ["parent before subagents", ["parent", "child-covered", "child-stopped", "acp", "codex"]],
  ["parent between subagents", ["child-covered", "parent", "child-stopped", "codex", "acp"]],
] as const;

for (const [orderName, deleteOrder] of deleteOrders) {
  it.layer(layer)(`token accounting, deleting ${orderName}`, (it) => {
    it.effect("counts each native session and uncovered Claude subagent exactly once", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const stats = yield* ProfileStatsQuery;
        const archive = yield* ProfileStatsArchive;
        yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, created_at, updated_at)
          VALUES ('project', 'Token fixture', '/nonexistent-token-fixture', '[]', ${date}, ${date})`;
        const threads = [
          { id: "codex", provider: "codex", parent: null, sourceTurn: null },
          { id: "acp", provider: "opencode", parent: null, sourceTurn: null },
          { id: "parent", provider: "claudeAgent", parent: null, sourceTurn: null },
          { id: "child-covered", provider: "claudeAgent", parent: "parent", sourceTurn: "covered" },
          { id: "child-stopped", provider: "claudeAgent", parent: "parent", sourceTurn: "stopped" },
        ];
        for (const thread of threads) {
          yield* sql`INSERT INTO projection_threads
            (thread_id, project_id, title, model_selection_json, creation_source, parent_thread_id,
             source_turn_id, created_at, updated_at)
            VALUES (${thread.id}, 'project', 'Usage',
              ${JSON.stringify({ provider: thread.provider, model: "model" })},
              ${thread.parent ? "provider_native" : null}, ${thread.parent}, ${thread.sourceTurn},
              ${date}, ${date})`;
        }
        const claudeResult = (modelUsage?: number) => ({
          provider: "claudeAgent",
          tokenAccountingVersion: 1,
          mainLoopTokens: 100,
          ...(modelUsage ? { modelUsage: { model: { totalTokens: modelUsage } } } : {}),
        });
        const activities = [
          // A resumed native session keeps its counter; a new native session starts from zero.
          [
            "codex",
            null,
            "context-window.updated",
            { totalProcessedTokens: 500, usageSessionId: "a:1" },
          ],
          [
            "codex",
            null,
            "context-window.updated",
            { totalProcessedTokens: 800, usageSessionId: "a:2" },
          ],
          [
            "codex",
            null,
            "context-window.updated",
            { totalProcessedTokens: 900, usageSessionId: "b:2" },
          ],
          // An ACP counter is Glade's own per-runtime sum, so a resumed session starts over.
          [
            "acp",
            null,
            "context-window.updated",
            { provider: "opencode", totalProcessedTokens: 300, usageSessionId: "s:1" },
          ],
          [
            "acp",
            null,
            "context-window.updated",
            { provider: "opencode", totalProcessedTokens: 400, usageSessionId: "s:2" },
          ],
          ["parent", "covered", "turn.completed", claudeResult(300)],
          ["parent", "stopped", "turn.completed", claudeResult()],
          ["child-covered", "child-covered-turn", "turn.completed", claudeResult(200)],
          ["child-stopped", "child-stopped-turn", "turn.completed", claudeResult(200)],
        ] as const;
        for (const [index, [threadId, turnId, kind, payload]] of activities.entries()) {
          yield* sql`INSERT INTO projection_thread_activities
            (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at)
            VALUES (${`activity-${index}`}, ${threadId}, ${turnId}, 'info', ${kind}, 'usage',
              ${JSON.stringify({ provider: "codex", ...payload })}, ${index}, ${date})`;
        }
        const tokensByProvider = Effect.map(
          stats.getProfileTokenStats({ utcOffsetMinutes: 0 }),
          ({ models, lifetimeTotalTokens }) => ({
            ...Object.fromEntries(
              ["codex", "claudeAgent"].map((provider) => [
                provider,
                models.reduce((sum, row) => sum + (row.provider === provider ? row.tokens : 0), 0),
              ]),
            ),
            total: lifetimeTotalTokens,
          }),
        );
        const expected = { codex: 1_700, claudeAgent: 600, total: 3_000 };
        expect(yield* tokensByProvider).toEqual(expected);
        for (const threadId of deleteOrder) {
          yield* archive.purgeThreadWithStatsSnapshot({ threadId });
          expect(yield* tokensByProvider, `after deleting ${threadId}`).toEqual(expected);
        }
      }),
    );
  });
}

it.layer(layer)("resumed Claude results", (it) => {
  it.effect("counts the main loop of a stored result that restored earlier totals", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const stats = yield* ProfileStatsQuery;
      yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('project', 'Resume fixture', '/nonexistent-resume-fixture', '[]', ${date}, ${date})`;
      yield* sql`INSERT INTO projection_threads
        (thread_id, project_id, title, model_selection_json, created_at, updated_at)
        VALUES ('resumed', 'project', 'Resumed',
          ${JSON.stringify({ provider: "claudeAgent", model: "model" })}, ${date}, ${date})`;
      const results = [
        { modelUsage: 300, mainLoopTokens: 250 },
        { modelUsage: 200, mainLoopTokens: 200 },
        // A resumed process's first result also carries the 500 restored from the previous one.
        { modelUsage: 650, mainLoopTokens: 150 },
        // Background work beyond the main loop that matches no earlier span still counts.
        { modelUsage: 500, mainLoopTokens: 100 },
        // The adapter now withholds restored totals, so a marked result is never reinterpreted.
        { modelUsage: 600, mainLoopTokens: 100, restoredUsageExcluded: true },
      ];
      for (const [index, { modelUsage, ...result }] of results.entries()) {
        const payload = {
          provider: "claudeAgent",
          tokenAccountingVersion: 1,
          modelUsage: { model: { totalTokens: modelUsage } },
          ...result,
        };
        yield* sql`INSERT INTO projection_thread_activities
          (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at)
          VALUES (${`result-${index}`}, 'resumed', ${`turn-${index}`}, 'info', 'turn.completed',
            'usage', ${JSON.stringify(payload)}, ${index}, ${date})`;
      }
      const { lifetimeTotalTokens } = yield* stats.getProfileTokenStats({ utcOffsetMinutes: 0 });
      expect(lifetimeTotalTokens).toBe(300 + 200 + 150 + 500 + 600);
    }),
  );
});
