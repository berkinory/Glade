import { Schema, Effect } from "effect";
import {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
} from "@glade/contracts/orchestration/snapshots";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  type ProjectionSnapshotQueryShape,
  type ProjectionSnapshotCounts,
  type ProjectionSnapshotSequence,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  toPersistenceSqlOrDecodeError,
  toPersistenceDecodeError,
  isPersistenceError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import {
  type OrchestrationProject,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import { makeSnapshotBaseQueries } from "./snapshotBaseQueries";
import { makeSnapshotMessageQueries } from "./snapshotMessageQueries";
import { makeSnapshotHistoryQueries } from "./snapshotHistoryQueries";
import {
  decodeProjectionProjectRows,
  decodeProjectionThreadRows,
  decodeProjectionThreadShellRows,
} from "./snapshotDecoding";
import {
  collectProjectedMessages,
  attachThreadMessageSegments,
  collectProjectedProposedPlans,
  collectProjectedActivities,
  collectPendingInteractions,
  collectProjectedCheckpoints,
  collectProjectedLatestTurns,
  collectProjectedSessions,
  collectBaseUpdatedAt,
  maxOptionalIso,
  toProjectedProject,
  toProjectedThread,
  toProjectedSpace,
  toProjectedSpaceShell,
  toProjectedProjectShell,
  toProjectedThreadShellFromStoredSummary,
} from "./snapshotAssembly";
import { computeSnapshotSequence } from "./snapshotCursor";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);

const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);

export function makeSnapshotReadModels(input: {
  readonly sql: SqlClient.SqlClient;
  readonly listSpaceRows: ReturnType<typeof makeSnapshotBaseQueries>["listSpaceRows"];
  readonly listProjectRows: ReturnType<typeof makeSnapshotBaseQueries>["listProjectRows"];
  readonly listThreadRows: ReturnType<typeof makeSnapshotBaseQueries>["listThreadRows"];
  readonly listThreadMessageRows: ReturnType<
    typeof makeSnapshotMessageQueries
  >["listThreadMessageRows"];
  readonly listThreadProposedPlanRows: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listThreadProposedPlanRows"];
  readonly listThreadActivityRows: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listThreadActivityRows"];
  readonly listPendingInteractionRows: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listPendingInteractionRows"];
  readonly listThreadSessionRows: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listThreadSessionRows"];
  readonly listCheckpointRows: ReturnType<typeof makeSnapshotHistoryQueries>["listCheckpointRows"];
  readonly listLatestTurnRows: ReturnType<typeof makeSnapshotHistoryQueries>["listLatestTurnRows"];
  readonly listProjectionStateRows: ReturnType<
    typeof makeSnapshotBaseQueries
  >["listProjectionStateRows"];
  readonly loadMessageSegments: ReturnType<
    typeof makeSnapshotMessageQueries
  >["loadMessageSegments"];
  readonly listCheckpointRevertLifecycleActivityRows: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listCheckpointRevertLifecycleActivityRows"];
  readonly listThreadShellRows: ReturnType<typeof makeSnapshotBaseQueries>["listThreadShellRows"];
  readonly readEmptyProjectShellRepair: ReturnType<
    typeof makeSnapshotBaseQueries
  >["readEmptyProjectShellRepair"];
  readonly readProjectionCounts: ReturnType<typeof makeSnapshotBaseQueries>["readProjectionCounts"];
}) {
  const {
    sql,
    listSpaceRows,
    listProjectRows,
    listThreadRows,
    listThreadMessageRows,
    listThreadProposedPlanRows,
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
  } = input;
  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            spaceRows,
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            pendingInteractionRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listSpaceRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listSpaces:query",
                  "ProjectionSnapshotQuery.getSnapshot:listSpaces:decodeRows",
                ),
              ),
            ),
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionProjectRows(
                  rows,
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeModelSelections",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionThreadRows(
                  rows,
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeModelSelections",
                ),
              ),
            ),
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listPendingInteractionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listPendingInteractions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listPendingInteractions:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const segmentRows = yield* loadMessageSegments(
            messageRows,
            "ProjectionSnapshotQuery.getSnapshot",
          );
          const messages = collectProjectedMessages(
            attachThreadMessageSegments(messageRows, segmentRows),
          );
          const proposedPlans = collectProjectedProposedPlans(proposedPlanRows);
          const activities = collectProjectedActivities(activityRows);
          const pendingInteractions = collectPendingInteractions(pendingInteractionRows);
          const checkpoints = collectProjectedCheckpoints(checkpointRows);
          const latestTurns = collectProjectedLatestTurns(latestTurnRows);
          const sessions = collectProjectedSessions(sessionRows);

          let updatedAt = collectBaseUpdatedAt({ spaceRows, projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, messages.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, proposedPlans.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, activities.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, pendingInteractions.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, checkpoints.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map(toProjectedProject);

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) =>
            toProjectedThread({
              threadRow: row,
              latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
              messages: messages.byThread.get(row.threadId) ?? [],
              proposedPlans: proposedPlans.byThread.get(row.threadId) ?? [],
              activities: activities.byThread.get(row.threadId) ?? [],
              pendingInteractions: pendingInteractions.byThread.get(row.threadId) ?? [],
              checkpoints: checkpoints.byThread.get(row.threadId) ?? [],
              session: sessions.byThread.get(row.threadId) ?? null,
            }),
          );

          const snapshot = {
            snapshotSequence: yield* computeSnapshotSequence(stateRows),
            spaces: spaceRows.map(toProjectedSpace),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getCommandReadModel: ProjectionSnapshotQueryShape["getCommandReadModel"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            spaceRows,
            projectRows,
            threadRows,
            proposedPlanRows,
            checkpointRevertActivityRows,
            sessionRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listSpaceRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listSpaces:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listSpaces:decodeRows",
                ),
              ),
            ),
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionProjectRows(
                  rows,
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:decodeModelSelections",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionThreadRows(
                  rows,
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:decodeModelSelections",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listCheckpointRevertLifecycleActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listCheckpointRevertActivities:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listCheckpointRevertActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const proposedPlans = collectProjectedProposedPlans(proposedPlanRows);
          const checkpointRevertActivities = collectProjectedActivities(
            checkpointRevertActivityRows,
          );
          const sessions = collectProjectedSessions(sessionRows);
          const latestTurns = collectProjectedLatestTurns(latestTurnRows);

          let updatedAt = collectBaseUpdatedAt({ spaceRows, projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, proposedPlans.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, checkpointRevertActivities.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map(toProjectedProject);

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) =>
            toProjectedThread({
              threadRow: row,
              latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
              messages: [],
              proposedPlans: proposedPlans.byThread.get(row.threadId) ?? [],
              activities: checkpointRevertActivities.byThread.get(row.threadId) ?? [],
              pendingInteractions: [],
              checkpoints: [],
              session: sessions.byThread.get(row.threadId) ?? null,
            }),
          );

          return yield* decodeReadModel({
            snapshotSequence: yield* computeSnapshotSequence(stateRows),
            spaces: spaceRows.map(toProjectedSpace),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:decodeReadModel",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getCommandReadModel:query")(error);
        }),
      );

  const getShellSnapshot: ProjectionSnapshotQueryShape["getShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [spaceRows, projectRows, threadRows, sessionRows, latestTurnRows, stateRows] =
            yield* Effect.all([
              listSpaceRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listSpaces:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listSpaces:decodeRows",
                  ),
                ),
              ),
              listProjectRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeRows",
                  ),
                ),
                Effect.flatMap((rows) =>
                  decodeProjectionProjectRows(
                    rows,
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeModelSelections",
                  ),
                ),
              ),
              listThreadShellRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:decodeRows",
                  ),
                ),
                Effect.flatMap((rows) =>
                  decodeProjectionThreadShellRows(
                    rows,
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:decodeModelSelections",
                  ),
                ),
              ),
              listThreadSessionRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:decodeRows",
                  ),
                ),
              ),
              listLatestTurnRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:decodeRows",
                  ),
                ),
              ),
              listProjectionStateRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:decodeRows",
                  ),
                ),
              ),
            ]);

          const latestTurns = collectProjectedLatestTurns(latestTurnRows);
          const sessions = collectProjectedSessions(sessionRows);

          let updatedAt = collectBaseUpdatedAt({ spaceRows, projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);

          const shellIsEmpty =
            !projectRows.some((row) => row.deletedAt === null) &&
            !threadRows.some((row) => row.deletedAt === null);
          const requiresEmptyProjectShellRepair = shellIsEmpty
            ? yield* readEmptyProjectShellRepair(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:emptyProjectShellRepair:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:emptyProjectShellRepair:decodeRow",
                  ),
                ),
                Effect.map((row) => row.required > 0),
              )
            : false;

          const snapshot = {
            snapshotSequence: yield* computeSnapshotSequence(stateRows),
            requiresEmptyProjectShellRepair,
            spaces: spaceRows.filter((row) => row.deletedAt === null).map(toProjectedSpaceShell),
            projects: projectRows
              .filter((row) => row.deletedAt === null)
              .map((row) => toProjectedProjectShell(row)),
            threads: threadRows
              .filter((row) => row.deletedAt === null)
              .map((row) =>
                toProjectedThreadShellFromStoredSummary({
                  threadRow: row,
                  latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
                  session: sessions.byThread.get(row.threadId) ?? null,
                }),
              ),
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeShellSnapshot(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:decodeShellSnapshot",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getShellSnapshot:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getSnapshotSequence: ProjectionSnapshotQueryShape["getSnapshotSequence"] = () =>
    listProjectionStateRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getSnapshotSequence:query",
          "ProjectionSnapshotQuery.getSnapshotSequence:decodeRows",
        ),
      ),
      Effect.flatMap((stateRows) =>
        computeSnapshotSequence(stateRows).pipe(
          Effect.map((snapshotSequence): ProjectionSnapshotSequence => ({ snapshotSequence })),
        ),
      ),
    );
  return { getCommandReadModel, getSnapshot, getShellSnapshot, getCounts, getSnapshotSequence };
}
