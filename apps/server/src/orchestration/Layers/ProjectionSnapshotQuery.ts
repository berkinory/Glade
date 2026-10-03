import { createHash } from "node:crypto";
import { ServerConfig } from "../../server/config";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  type ProjectionSnapshotQueryShape,
  ProjectionSnapshotQuery,
} from "../Services/ProjectionSnapshotQuery.ts";
import { makeSnapshotBaseQueries } from "../projection/snapshotBaseQueries";
import { makeSnapshotMessageQueries } from "../projection/snapshotMessageQueries";
import { makeSnapshotHistoryQueries } from "../projection/snapshotHistoryQueries";
import { makeSnapshotThreadQueries } from "../projection/snapshotThreadQueries";
import { makeSnapshotReadModels } from "../projection/snapshotReadModels";
import { makeSnapshotProjectLookup } from "../projection/snapshotProjectLookup";
import { makeSnapshotThreadLookup } from "../projection/snapshotThreadLookup";
import { makeSnapshotThreadDetails } from "../projection/snapshotThreadDetails";

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* Effect.serviceOption(ServerConfig);
  const persistenceScope =
    config._tag === "Some"
      ? createHash("sha256").update(config.value.stateDir).digest("hex")
      : undefined;

  const liveThreadScope = sql`
    thread_id IN (SELECT thread_id FROM projection_threads WHERE deleted_at IS NULL)
  `;

  const {
    listSpaceRows,
    listProjectRows,
    listThreadRows,
    listProjectionStateRows,
    listThreadShellRows,
    readEmptyProjectShellRepair,
    readProjectionCounts,
  } = makeSnapshotBaseQueries({ sql });
  const {
    listThreadMessageRows,
    loadMessageSegments,
    listThreadMessageRowsByThread,
    countThreadMessageRows,
  } = makeSnapshotMessageQueries({ sql, liveThreadScope });
  const {
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
  } = makeSnapshotHistoryQueries({ sql, liveThreadScope });
  const {
    listStaleInFlightThreadIdRows,
    listManagedWorktreeThreadRows,
    getActiveProjectRowByWorkspaceRoot,
    getProjectRowById,
    getSpaceRowById,
    getFirstActiveThreadIdByProject,
    getThreadCheckpointContextThreadRow,
    getFullThreadDiffContextRow,
    getAnyThreadIdRowById,
    getThreadRowById,
    listThreadRowsByIds,
    listLatestTurnRowsByThreads,
    listThreadSessionRowsByThreads,
    getSyntheticSubagentParentThreadRow,
  } = makeSnapshotThreadQueries({ sql });
  const { getCommandReadModel, getSnapshot, getShellSnapshot, getCounts, getSnapshotSequence } =
    makeSnapshotReadModels({
      sql,
      persistenceScope,
      listSpaceRows,
      listProjectRows,
      listThreadRows,
      listThreadMessageRows,

      listThreadActivityRows,
      listPendingInteractionRows,
      listThreadSessionRows,
      listCheckpointRows,
      listLatestTurnRows,
      listProjectionStateRows,
      loadMessageSegments,
      listCheckpointRevertLifecycleActivityRows,
      listThreadShellRows,
      readEmptyProjectShellRepair,
      readProjectionCounts,
    });
  const {
    getActiveProjectByWorkspaceRoot,
    getProjectShellById,
    getSpaceShellById,
    getFirstActiveThreadIdByProjectId,
  } = makeSnapshotProjectLookup({
    getActiveProjectRowByWorkspaceRoot,
    getProjectRowById,
    getSpaceRowById,
    getFirstActiveThreadIdByProject,
  });
  const {
    listStaleInFlightThreadIds,
    listManagedWorktreeThreads,
    getThreadCheckpointContext,
    listGeneratedImageActivitiesByTurn,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadShellsByIds,
    threadIdExistsIncludingDeleted,
    findSyntheticSubagentParentThread,
  } = makeSnapshotThreadLookup({
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
    listThreadRowsByIds,
    listLatestTurnRowsByThreads,
    listThreadSessionRowsByThreads,
    getSyntheticSubagentParentThreadRow,
  });
  const {
    getThreadDetailById,
    getThreadMentionContextById,
    getThreadDetailForExportById,
    getThreadDetailSnapshotById,
  } = makeSnapshotThreadDetails({
    getThreadRowById,
    listThreadMessageRowsByThread,

    listThreadActivityRowsByThread,
    listPendingInteractionRowsByThread,
    listCheckpointRowsByThread,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    loadMessageSegments,
    sql,
    countThreadMessageRows,
    listProjectionStateRows,
  });

  return {
    getCommandReadModel,
    getSnapshot,
    getShellSnapshot,
    getCounts,
    getSnapshotSequence,
    listStaleInFlightThreadIds,
    listManagedWorktreeThreads,
    getActiveProjectByWorkspaceRoot,
    getProjectShellById,
    getSpaceShellById,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
    listGeneratedImageActivitiesByTurn,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadShellsByIds,
    threadIdExistsIncludingDeleted,
    findSyntheticSubagentParentThread,
    getThreadDetailById,
    getThreadMentionContextById,
    getThreadDetailForExportById,
    getThreadDetailSnapshotById,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
