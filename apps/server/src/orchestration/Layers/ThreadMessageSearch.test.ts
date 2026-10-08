import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ThreadMessageSearch } from "../Services/ThreadMessageSearch.ts";
import { ThreadMessageSearchLive } from "./ThreadMessageSearch.ts";

const layer = ThreadMessageSearchLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const date = "2026-10-08T12:00:00.000Z";

const THREADS = [
  { id: "live", project: "project", extra: {} },
  { id: "archived", project: "project", extra: { archived_at: date } },
  { id: "deleted", project: "project", extra: { deleted_at: date } },
  { id: "subagent", project: "project", extra: { parent_thread_id: "live" } },
  { id: "removed-project", project: "removed", extra: {} },
] as const;

const MESSAGES = [
  { thread: "live", role: "user", text: "Rapor İSTANBUL ofisinden geldi", streaming: 0 },
  { thread: "live", role: "assistant", text: "Progress is 100% done", streaming: 0 },
  { thread: "live", role: "assistant", text: "still streaming draft", streaming: 1 },
  { thread: "live", role: "system", text: "system prompt text", streaming: 0 },
  ...THREADS.filter((thread) => thread.id !== "live").map((thread) => ({
    thread: thread.id,
    role: "user",
    text: "hidden needle",
    streaming: 0,
  })),
];

it.layer(layer)("ThreadMessageSearch", (it) => {
  it.effect("finds settled messages only in chats the sidebar shows, matching literally", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const search = yield* ThreadMessageSearch;
      for (const [projectId, deletedAt] of [
        ["project", null],
        ["removed", date],
      ] as const) {
        yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
          VALUES (${projectId}, ${projectId}, ${`/nonexistent/${projectId}`}, '[]', ${date}, ${date}, ${deletedAt})`;
      }
      for (const thread of THREADS) {
        yield* sql`INSERT INTO projection_threads
          (thread_id, project_id, title, created_at, updated_at, archived_at, deleted_at, parent_thread_id)
          VALUES (${thread.id}, ${thread.project}, 'Fixture', ${date}, ${date},
            ${"archived_at" in thread.extra ? thread.extra.archived_at : null},
            ${"deleted_at" in thread.extra ? thread.extra.deleted_at : null},
            ${"parent_thread_id" in thread.extra ? thread.extra.parent_thread_id : null})`;
      }
      for (const [index, message] of MESSAGES.entries()) {
        yield* sql`INSERT INTO projection_thread_messages
          (thread_id, message_id, role, text, is_streaming, created_at, updated_at)
          VALUES (${message.thread}, ${`m${index}`}, ${message.role}, ${message.text},
            ${message.streaming}, ${date}, ${date})`;
      }
      yield* sql`INSERT INTO projection_thread_messages
        (thread_id, message_id, role, text, text_json, is_streaming, created_at, updated_at)
        VALUES ('live', 'encoded', 'assistant', '', ${JSON.stringify("encoded şeker body")}, 0, ${date}, ${date})`;

      const cases = [
        ["istanbul", ["live"]],
        ["rapor İstanbul", ["live"]],
        ["ŞEKER", ["live"]],
        ["100%", ["live"]],
        ["10_%", []],
        ["hidden needle", []],
        ["streaming draft", []],
        ["system prompt", []],
      ] as const;
      for (const [query, threadIds] of cases) {
        const result = yield* search.search({ query });
        expect(
          result.matches.map((match) => match.threadId),
          query,
        ).toEqual(threadIds);
      }
    }),
  );
});
