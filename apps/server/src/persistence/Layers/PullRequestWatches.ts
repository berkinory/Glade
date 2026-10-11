import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  PullRequestWatchRepository,
  type PullRequestWatchRecord,
  type PullRequestWatchRepositoryShape,
} from "../Services/PullRequestWatches.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql`
    thread_id AS "threadId",
    cwd,
    pr_number AS "number",
    started_at AS "startedAt",
    last_event AS "lastEvent",
    state_json AS "stateJson"
  `;

  return {
    list: sql<PullRequestWatchRecord>`
      SELECT ${columns} FROM thread_pull_request_watches ORDER BY started_at ASC
    `.pipe(Effect.mapError(toPersistenceSqlError("PullRequestWatch.list"))),
    get: (threadId) =>
      sql<PullRequestWatchRecord>`
        SELECT ${columns} FROM thread_pull_request_watches WHERE thread_id = ${threadId}
      `.pipe(
        Effect.map((rows) => rows[0] ?? null),
        Effect.mapError(toPersistenceSqlError("PullRequestWatch.get")),
      ),
    upsert: (record) =>
      sql`
        INSERT INTO thread_pull_request_watches (
          thread_id, cwd, pr_number, started_at, updated_at, last_event, state_json
        ) VALUES (
          ${record.threadId}, ${record.cwd}, ${record.number}, ${record.startedAt},
          ${record.updatedAt}, ${record.lastEvent}, ${record.stateJson}
        )
        ON CONFLICT (thread_id) DO UPDATE SET
          cwd = excluded.cwd,
          pr_number = excluded.pr_number,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          last_event = excluded.last_event,
          state_json = excluded.state_json
      `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("PullRequestWatch.upsert"))),
    update: (input) =>
      sql`
        UPDATE thread_pull_request_watches
        SET last_event = ${input.lastEvent}, state_json = ${input.stateJson},
            updated_at = ${input.updatedAt}
        WHERE thread_id = ${input.threadId} AND started_at = ${input.startedAt}
      `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("PullRequestWatch.update"))),
    remove: (threadId) =>
      sql`DELETE FROM thread_pull_request_watches WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("PullRequestWatch.remove")),
      ),
  } satisfies PullRequestWatchRepositoryShape;
});

export const PullRequestWatchRepositoryLive = Layer.effect(PullRequestWatchRepository, make);
