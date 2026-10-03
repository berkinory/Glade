import { IsoDateTime, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { makeSnapshotBaseQueries } from "../../orchestration/projection/snapshotBaseQueries";
import { decodeProjectionProjectRows } from "../../orchestration/projection/snapshotDecoding";
import { toProjectedProjectShell } from "../../orchestration/projection/snapshotAssembly";
import { toPersistenceSqlOrDecodeError, toPersistenceSqlError } from "../../persistence/Errors";
import {
  AgentGatewayDiscovery,
  type AgentGatewayDiscoveryShape,
} from "../Services/AgentGatewayDiscovery";
import { stableGatewayDigest } from "../creationUtils";
import { ToolInputError } from "../toolInput";

const ThreadListCursor = Schema.Struct({
  version: Schema.Literal(1),
  filters: Schema.String,
  updatedAt: IsoDateTime,
  threadId: ThreadId,
});

export const AgentGatewayDiscoveryLive = Layer.effect(
  AgentGatewayDiscovery,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const snapshots = yield* ProjectionSnapshotQuery;
    const { listProjectRows } = makeSnapshotBaseQueries({ sql });
    const listProjects = listProjectRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AgentGatewayDiscovery.projects",
          "AgentGatewayDiscovery.projects.decode",
        ),
      ),
      Effect.flatMap((rows) =>
        decodeProjectionProjectRows(rows, "AgentGatewayDiscovery.projects.models"),
      ),
      Effect.map((rows) =>
        rows.filter((row) => row.deletedAt === null).map(toProjectedProjectShell),
      ),
    );
    const listThreads: AgentGatewayDiscoveryShape["listThreads"] = (input) =>
      Effect.gen(function* () {
        const { cursor: rawCursor, limit = 20, ...filters } = input;
        const fingerprint = stableGatewayDigest({
          ...filters,
          includeArchived: filters.includeArchived ?? false,
        });
        const cursor =
          rawCursor === undefined
            ? undefined
            : yield* Effect.try({
                try: () =>
                  Schema.decodeUnknownSync(ThreadListCursor)(
                    JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")),
                  ),
                catch: () =>
                  new ToolInputError(
                    "Invalid thread list cursor. Reuse the returned cursor and original filters.",
                  ),
              });
        if (cursor && cursor.filters !== fingerprint)
          return yield* Effect.fail(
            new ToolInputError("Thread list cursor filters changed. Restart pagination."),
          );
        // Mirror the public status precedence: pending interactions outrank running/error states.
        const status = sql`CASE
      WHEN t.pending_approval_count > 0 THEN 'waiting-for-approval'
      WHEN t.pending_user_input_count > 0 THEN 'waiting-for-user-input'
      WHEN turn.state = 'running' OR session.status IN ('running', 'starting') THEN 'working'
      WHEN turn.state = 'error' OR session.status = 'error' THEN 'error'
      WHEN turn.state = 'interrupted' THEN 'interrupted'
      ELSE 'idle' END`;
        const clauses = [sql`t.deleted_at IS NULL`];
        if (!filters.includeArchived) clauses.push(sql`t.archived_at IS NULL`);
        if (filters.projectId) clauses.push(sql`t.project_id = ${filters.projectId}`);
        if (filters.parentThreadId)
          clauses.push(sql`t.parent_thread_id = ${filters.parentThreadId}`);
        if (filters.provider)
          clauses.push(
            sql`json_extract(t.model_selection_json, '$.provider') = ${filters.provider}`,
          );
        if (filters.model)
          clauses.push(sql`json_extract(t.model_selection_json, '$.model') = ${filters.model}`);
        if (filters.status) clauses.push(sql`${status} = ${filters.status}`);
        if (filters.titleContains)
          clauses.push(sql`instr(lower(t.title), lower(${filters.titleContains})) > 0`);
        if (filters.creationSource)
          clauses.push(sql`t.creation_source = ${filters.creationSource}`);
        if (filters.updatedAfter) clauses.push(sql`t.updated_at >= ${filters.updatedAfter}`);
        if (filters.updatedBefore) clauses.push(sql`t.updated_at <= ${filters.updatedBefore}`);
        if (cursor)
          clauses.push(
            sql`(t.updated_at < ${cursor.updatedAt} OR (t.updated_at = ${cursor.updatedAt} AND t.thread_id < ${cursor.threadId}))`,
          );
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* sql<{ threadId: string; updatedAt: string }>`
        SELECT t.thread_id AS "threadId", t.updated_at AS "updatedAt"
        FROM projection_threads t
        LEFT JOIN projection_turns turn ON turn.thread_id = t.thread_id AND turn.turn_id = t.latest_turn_id
        LEFT JOIN projection_thread_sessions session ON session.thread_id = t.thread_id
        WHERE ${sql.and(clauses)}
        ORDER BY t.updated_at DESC, t.thread_id DESC LIMIT ${limit + 1}
      `;
              const page = rows.slice(0, limit);
              const shells = yield* snapshots.getThreadShellsByIds(
                page.map((row) => ThreadId.makeUnsafe(row.threadId)),
              );
              const byId = new Map(shells.map((thread) => [thread.id, thread]));
              const last = page.at(-1);
              return {
                threads: page.flatMap((row) => {
                  const thread = byId.get(ThreadId.makeUnsafe(row.threadId));
                  return thread ? [thread] : [];
                }),
                nextCursor:
                  rows.length > limit && last
                    ? Buffer.from(
                        JSON.stringify({ version: 1, filters: fingerprint, ...last }),
                      ).toString("base64url")
                    : null,
              };
            }),
          )
          .pipe(Effect.mapError(toPersistenceSqlError("AgentGatewayDiscovery.threads")));
      });
    return { listProjects, listThreads } satisfies AgentGatewayDiscoveryShape;
  }),
);
