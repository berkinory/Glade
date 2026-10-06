import { readBackgroundActivities } from "./backgroundWorkQuery";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  type ProjectionSnapshotQueryShape,
  type ProjectionManagedWorktreeThread,
  type ProjectionThreadCheckpointContext,
  type ProjectionGeneratedImageActivityRecord,
  type ProjectionFullThreadDiffContext,
} from "../Services/ProjectionSnapshotQuery.ts";
import { Effect, Option } from "effect";
import {
  toPersistenceSqlOrDecodeError,
  isPersistenceError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import {
  type OrchestrationCheckpointSummary,
  type OrchestrationThreadShell,
} from "@glade/contracts/orchestration/threadEntities";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeSnapshotThreadQueries } from "./snapshotThreadQueries";
import { makeSnapshotHistoryQueries } from "./snapshotHistoryQueries";
import { decodeProjectionThreadOption, decodeProjectionThreadRows } from "./snapshotDecoding";
import {
  toProjectedThreadShellFromStoredSummary,
  toProjectedLatestTurn,
  toProjectedSession,
} from "./snapshotAssembly";

export function makeSnapshotThreadLookup(input: {
  readonly listStaleInFlightThreadIdRows: ReturnType<
    typeof makeSnapshotThreadQueries
  >["listStaleInFlightThreadIdRows"];
  readonly listManagedWorktreeThreadRows: ReturnType<
    typeof makeSnapshotThreadQueries
  >["listManagedWorktreeThreadRows"];
  readonly getThreadCheckpointContextThreadRow: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getThreadCheckpointContextThreadRow"];
  readonly listCheckpointRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listCheckpointRowsByThread"];
  readonly listGeneratedImageActivityRowsByTurn: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listGeneratedImageActivityRowsByTurn"];
  readonly getFullThreadDiffContextRow: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getFullThreadDiffContextRow"];
  readonly getAnyThreadIdRowById: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getAnyThreadIdRowById"];
  readonly getThreadRowById: ReturnType<typeof makeSnapshotThreadQueries>["getThreadRowById"];
  readonly getLatestTurnRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getLatestTurnRowByThread"];
  readonly getThreadSessionRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getThreadSessionRowByThread"];
  readonly sql: SqlClient.SqlClient;
  readonly listChildThreadIdRows: ReturnType<
    typeof makeSnapshotThreadQueries
  >["listChildThreadIdRows"];
  readonly listThreadRowsByIds: ReturnType<typeof makeSnapshotThreadQueries>["listThreadRowsByIds"];
  readonly listLatestTurnRowsByThreads: ReturnType<
    typeof makeSnapshotThreadQueries
  >["listLatestTurnRowsByThreads"];
  readonly listThreadSessionRowsByThreads: ReturnType<
    typeof makeSnapshotThreadQueries
  >["listThreadSessionRowsByThreads"];
  readonly getSyntheticSubagentParentThreadRow: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getSyntheticSubagentParentThreadRow"];
}) {
  const {
    listStaleInFlightThreadIdRows,
    listManagedWorktreeThreadRows,
    getThreadCheckpointContextThreadRow,
    listCheckpointRowsByThread,
    listGeneratedImageActivityRowsByTurn,
    getFullThreadDiffContextRow,
    getAnyThreadIdRowById,
    getThreadRowById,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    sql,
    listChildThreadIdRows,
    listThreadRowsByIds,
    listLatestTurnRowsByThreads,
    listThreadSessionRowsByThreads,
    getSyntheticSubagentParentThreadRow,
  } = input;
  const listStaleInFlightThreadIds: ProjectionSnapshotQueryShape["listStaleInFlightThreadIds"] = (
    input,
  ) =>
    listStaleInFlightThreadIdRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.listStaleInFlightThreadIds:query",
          "ProjectionSnapshotQuery.listStaleInFlightThreadIds:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map((row) => row.threadId)),
    );

  const listManagedWorktreeThreads: ProjectionSnapshotQueryShape["listManagedWorktreeThreads"] =
    () =>
      listManagedWorktreeThreadRows(undefined).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.listManagedWorktreeThreads:query",
            "ProjectionSnapshotQuery.listManagedWorktreeThreads:decodeRows",
          ),
        ),
        Effect.map((rows) =>
          rows.map(
            (row): ProjectionManagedWorktreeThread => ({
              id: row.threadId,
              archivedAt: row.archivedAt ?? null,
              deletedAt: row.deletedAt ?? null,
              worktreePath: row.worktreePath ?? null,
              associatedWorktreePath: row.associatedWorktreePath ?? null,
            }),
          ),
        ),
      );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow",
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );
      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        projectKind: threadRow.value.projectKind,
        workspaceRoot: threadRow.value.workspaceRoot,
        envMode: threadRow.value.envMode,
        worktreePath: threadRow.value.worktreePath,
        workingDirectory: threadRow.value.workingDirectory,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  const listGeneratedImageActivitiesByTurn: ProjectionSnapshotQueryShape["listGeneratedImageActivitiesByTurn"] =
    (threadId, turnId) =>
      listGeneratedImageActivityRowsByTurn({ threadId, turnId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.listGeneratedImageActivitiesByTurn:query",
            "ProjectionSnapshotQuery.listGeneratedImageActivitiesByTurn:decodeRows",
          ),
        ),
        Effect.map(
          (rows): ReadonlyArray<ProjectionGeneratedImageActivityRecord> =>
            rows.map((row) => ({ kind: row.kind, payload: row.payload })),
        ),
      );

  const getFullThreadDiffContext: ProjectionSnapshotQueryShape["getFullThreadDiffContext"] = (
    threadId,
    toTurnCount,
  ) =>
    Effect.gen(function* () {
      const row = yield* getFullThreadDiffContextRow({
        threadId,
        checkpointTurnCount: toTurnCount,
      }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFullThreadDiffContext:query",
            "ProjectionSnapshotQuery.getFullThreadDiffContext:decodeRow",
          ),
        ),
      );
      if (Option.isNone(row)) {
        return Option.none<ProjectionFullThreadDiffContext>();
      }

      return Option.some({
        threadId: row.value.threadId,
        projectId: row.value.projectId,
        projectKind: row.value.projectKind,
        workspaceRoot: row.value.workspaceRoot,
        envMode: row.value.envMode,
        worktreePath: row.value.worktreePath,
        workingDirectory: row.value.workingDirectory,
        latestCheckpointTurnCount: row.value.latestCheckpointTurnCount ?? 0,
        baselineCheckpointRef: row.value.baselineCheckpointRef,
        toCheckpointRef: row.value.toCheckpointRef,
      });
    });

  const threadIdExistsIncludingDeleted: ProjectionSnapshotQueryShape["threadIdExistsIncludingDeleted"] =
    (threadId) =>
      getAnyThreadIdRowById({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.threadIdExistsIncludingDeleted:query",
            "ProjectionSnapshotQuery.threadIdExistsIncludingDeleted:decodeRow",
          ),
        ),
        Effect.map(Option.isSome),
      );

  const loadThreadShell = (threadId: ThreadId, tracePrefix: string) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadRowById({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            `${tracePrefix}:getThread:query`,
            `${tracePrefix}:getThread:decodeRow`,
          ),
        ),
        Effect.flatMap((option) =>
          decodeProjectionThreadOption(option, `${tracePrefix}:getThread:decodeModelSelection`),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<OrchestrationThreadShell>();
      }

      const [latestTurnRow, sessionRow] = yield* Effect.all([
        getLatestTurnRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${tracePrefix}:getLatestTurn:query`,
              `${tracePrefix}:getLatestTurn:decodeRow`,
            ),
          ),
        ),
        getThreadSessionRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${tracePrefix}:getSession:query`,
              `${tracePrefix}:getSession:decodeRow`,
            ),
          ),
        ),
      ]);

      const taskActivities = yield* readBackgroundActivities(sql, [threadId]);
      return Option.some(
        toProjectedThreadShellFromStoredSummary({
          taskActivities: taskActivities(threadId),
          threadRow: threadRow.value,
          latestTurn: Option.match(latestTurnRow, {
            onNone: () => null,
            onSome: (row) => toProjectedLatestTurn(row),
          }),
          session: Option.match(sessionRow, {
            onNone: () => null,
            onSome: (row) => toProjectedSession(row),
          }),
        }),
      );
    });

  const getThreadShellsByIds: ProjectionSnapshotQueryShape["getThreadShellsByIds"] = (
    threadIds,
  ) => {
    const tracePrefix = "ProjectionSnapshotQuery.getThreadShellsByIds";
    const uniqueThreadIds = [...new Set(threadIds)];
    if (uniqueThreadIds.length === 0) {
      return Effect.succeed([]);
    }
    return sql
      .withTransaction(
        Effect.gen(function* () {
          const [threadRows, latestTurnRows, sessionRows] = yield* Effect.all([
            listThreadRowsByIds({ threadIds: uniqueThreadIds }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${tracePrefix}:listThreads:query`,
                  `${tracePrefix}:listThreads:decodeRows`,
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionThreadRows(
                  rows,
                  `${tracePrefix}:listThreads:decodeModelSelections`,
                ),
              ),
            ),
            listLatestTurnRowsByThreads({ threadIds: uniqueThreadIds }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${tracePrefix}:listLatestTurns:query`,
                  `${tracePrefix}:listLatestTurns:decodeRows`,
                ),
              ),
            ),
            listThreadSessionRowsByThreads({ threadIds: uniqueThreadIds }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${tracePrefix}:listSessions:query`,
                  `${tracePrefix}:listSessions:decodeRows`,
                ),
              ),
            ),
          ]);
          const latestTurnByThread = new Map(
            latestTurnRows.map((row) => [row.threadId, toProjectedLatestTurn(row)] as const),
          );
          const sessionByThread = new Map(
            sessionRows.map((row) => [row.threadId, toProjectedSession(row)] as const),
          );
          const taskActivities = yield* readBackgroundActivities(sql, uniqueThreadIds);
          return threadRows.map((threadRow) =>
            toProjectedThreadShellFromStoredSummary({
              threadRow,
              taskActivities: taskActivities(threadRow.threadId),
              latestTurn: latestTurnByThread.get(threadRow.threadId) ?? null,
              session: sessionByThread.get(threadRow.threadId) ?? null,
            }),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError(`${tracePrefix}:query`)(error);
        }),
      );
  };

  const listChildThreadShells: ProjectionSnapshotQueryShape["listChildThreadShells"] = (
    parentThreadId,
  ) =>
    listChildThreadIdRows({ parentThreadId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.listChildThreadShells:query",
          "ProjectionSnapshotQuery.listChildThreadShells:decodeRows",
        ),
      ),
      Effect.flatMap((rows) => getThreadShellsByIds(rows.map((row) => row.threadId))),
    );

  const getThreadShellById: ProjectionSnapshotQueryShape["getThreadShellById"] = (threadId) =>
    sql
      .withTransaction(loadThreadShell(threadId, "ProjectionSnapshotQuery.getThreadShellById"))
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadShellById:query")(error);
        }),
      );

  const findSyntheticSubagentParentThread: ProjectionSnapshotQueryShape["findSyntheticSubagentParentThread"] =
    (threadId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const parentRow = yield* getSyntheticSubagentParentThreadRow({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:query",
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:decodeRow",
                ),
              ),
              Effect.flatMap((option) =>
                decodeProjectionThreadOption(
                  option,
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:decodeModelSelection",
                ),
              ),
            );
            if (Option.isNone(parentRow)) {
              return Option.none<OrchestrationThreadShell>();
            }
            return yield* loadThreadShell(
              parentRow.value.threadId,
              "ProjectionSnapshotQuery.findSyntheticSubagentParentThread",
            );
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            if (isPersistenceError(error)) {
              return error;
            }
            return toPersistenceSqlError(
              "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:query",
            )(error);
          }),
        );
  return {
    listStaleInFlightThreadIds,
    listManagedWorktreeThreads,
    getThreadCheckpointContext,
    listGeneratedImageActivitiesByTurn,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadShellsByIds,
    listChildThreadShells,
    threadIdExistsIncludingDeleted,
    findSyntheticSubagentParentThread,
  };
}
