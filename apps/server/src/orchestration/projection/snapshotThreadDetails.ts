import { Schema, Effect, Option } from "effect";
import { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { OrchestrationThreadDetailSnapshot } from "@glade/contracts/orchestration/snapshots";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  toPersistenceSqlOrDecodeError,
  toPersistenceDecodeError,
  isPersistenceError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import { orchestrationMessageFromProjectionRow } from "../../persistence/projectionThreadMessageRow.ts";
import {
  type ProjectionSnapshotQueryShape,
  type OrchestrationThreadMentionContext,
} from "../Services/ProjectionSnapshotQuery.ts";
import { makeSnapshotThreadQueries } from "./snapshotThreadQueries";
import { makeSnapshotMessageQueries } from "./snapshotMessageQueries";
import { makeSnapshotHistoryQueries } from "./snapshotHistoryQueries";
import { makeSnapshotBaseQueries } from "./snapshotBaseQueries";
import { MAX_THREAD_MESSAGES } from "./snapshotSchemas";
import { decodeProjectionThreadOption } from "./snapshotDecoding";
import {
  toProjectedThread,
  toProjectedLatestTurn,
  attachThreadMessageSegments,
  toProjectedProposedPlan,
  toProjectedActivity,
  toProjectedCheckpoint,
  toProjectedSession,
} from "./snapshotAssembly";
import { computeSnapshotSequence } from "./snapshotCursor";

const decodeThreadDetail = Schema.decodeUnknownEffect(OrchestrationThread);

const decodeThreadDetailSnapshot = Schema.decodeUnknownEffect(OrchestrationThreadDetailSnapshot);

export function makeSnapshotThreadDetails(input: {
  readonly getThreadRowById: ReturnType<typeof makeSnapshotThreadQueries>["getThreadRowById"];
  readonly listThreadMessageRowsByThread: ReturnType<
    typeof makeSnapshotMessageQueries
  >["listThreadMessageRowsByThread"];
  readonly listThreadProposedPlanRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listThreadProposedPlanRowsByThread"];
  readonly listThreadActivityRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listThreadActivityRowsByThread"];
  readonly listPendingInteractionRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listPendingInteractionRowsByThread"];
  readonly listCheckpointRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listCheckpointRowsByThread"];
  readonly getLatestTurnRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getLatestTurnRowByThread"];
  readonly getThreadSessionRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getThreadSessionRowByThread"];
  readonly loadMessageSegments: ReturnType<
    typeof makeSnapshotMessageQueries
  >["loadMessageSegments"];
  readonly sql: SqlClient.SqlClient;
  readonly countThreadMessageRows: ReturnType<
    typeof makeSnapshotMessageQueries
  >["countThreadMessageRows"];
  readonly listProjectionStateRows: ReturnType<
    typeof makeSnapshotBaseQueries
  >["listProjectionStateRows"];
}) {
  const {
    getThreadRowById,
    listThreadMessageRowsByThread,
    listThreadProposedPlanRowsByThread,
    listThreadActivityRowsByThread,
    listPendingInteractionRowsByThread,
    listCheckpointRowsByThread,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    loadMessageSegments,
    sql,
    countThreadMessageRows,
    listProjectionStateRows,
  } = input;
  const loadThreadDetailRaw = (
    threadId: ThreadId,
    options: { readonly messageLimit: number | null; readonly tracePrefix: string } = {
      messageLimit: MAX_THREAD_MESSAGES,
      tracePrefix: "ProjectionSnapshotQuery.getThreadDetailById",
    },
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadRowById({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            `${options.tracePrefix}:getThread:query`,
            `${options.tracePrefix}:getThread:decodeRow`,
          ),
        ),
        Effect.flatMap((option) =>
          decodeProjectionThreadOption(
            option,
            `${options.tracePrefix}:getThread:decodeModelSelection`,
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ReturnType<typeof toProjectedThread>>();
      }

      const [
        messageRows,
        proposedPlanRows,
        activityRows,
        pendingInteractionRows,
        checkpointRows,
        latestTurnRow,
        sessionRow,
      ] = yield* Effect.all([
        listThreadMessageRowsByThread({ threadId, maxMessages: options.messageLimit }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listMessages:query`,
              `${options.tracePrefix}:listMessages:decodeRows`,
            ),
          ),
        ),
        listThreadProposedPlanRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listPlans:query`,
              `${options.tracePrefix}:listPlans:decodeRows`,
            ),
          ),
        ),
        listThreadActivityRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listActivities:query`,
              `${options.tracePrefix}:listActivities:decodeRows`,
            ),
          ),
        ),
        listPendingInteractionRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listPendingInteractions:query`,
              `${options.tracePrefix}:listPendingInteractions:decodeRows`,
            ),
          ),
        ),
        listCheckpointRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listCheckpoints:query`,
              `${options.tracePrefix}:listCheckpoints:decodeRows`,
            ),
          ),
        ),
        getLatestTurnRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:getLatestTurn:query`,
              `${options.tracePrefix}:getLatestTurn:decodeRow`,
            ),
          ),
        ),
        getThreadSessionRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:getSession:query`,
              `${options.tracePrefix}:getSession:decodeRow`,
            ),
          ),
        ),
      ]);

      const segmentRows = yield* loadMessageSegments(messageRows, options.tracePrefix);
      const thread = toProjectedThread({
        threadRow: threadRow.value,
        latestTurn: Option.match(latestTurnRow, {
          onNone: () => null,
          onSome: (row) => toProjectedLatestTurn(row),
        }),
        messages: attachThreadMessageSegments(messageRows, segmentRows).map(
          orchestrationMessageFromProjectionRow,
        ),
        proposedPlans: proposedPlanRows.map((row) => toProjectedProposedPlan(row)),
        activities: activityRows.map((row) => toProjectedActivity(row)),
        pendingInteractions: pendingInteractionRows,
        checkpoints: checkpointRows.map((row) => toProjectedCheckpoint(row)),
        session: Option.match(sessionRow, {
          onNone: () => null,
          onSome: (row) => toProjectedSession(row),
        }),
      });

      return Option.some(thread);
    });

  const loadThreadDetail = (
    threadId: ThreadId,
    options: { readonly messageLimit: number | null; readonly tracePrefix: string } = {
      messageLimit: MAX_THREAD_MESSAGES,
      tracePrefix: "ProjectionSnapshotQuery.getThreadDetailById",
    },
  ) =>
    loadThreadDetailRaw(threadId, options).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<OrchestrationThread>()),
          onSome: (thread) =>
            decodeThreadDetail(thread).pipe(
              Effect.map((decodedThread) => Option.some(decodedThread)),
              Effect.mapError(toPersistenceDecodeError(`${options.tracePrefix}:decodeThread`)),
            ),
        }),
      ),
    );

  const getThreadMentionContextById: ProjectionSnapshotQueryShape["getThreadMentionContextById"] = (
    threadId,
    options,
  ) => {
    const tracePrefix = "ProjectionSnapshotQuery.getThreadMentionContextById";
    return sql
      .withTransaction(
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
            return Option.none<OrchestrationThreadMentionContext>();
          }
          const [messageRows, messageCount] = yield* Effect.all([
            listThreadMessageRowsByThread({
              threadId,
              maxMessages: options.messageLimit,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${tracePrefix}:listMessages:query`,
                  `${tracePrefix}:listMessages:decodeRows`,
                ),
              ),
            ),
            countThreadMessageRows({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${tracePrefix}:countMessages:query`,
                  `${tracePrefix}:countMessages:decodeRow`,
                ),
              ),
            ),
          ]);
          const segmentRows = yield* loadMessageSegments(messageRows, tracePrefix);
          return Option.some<OrchestrationThreadMentionContext>({
            id: threadRow.value.threadId,
            title: threadRow.value.title,
            modelSelection: threadRow.value.modelSelection,
            messages: attachThreadMessageSegments(messageRows, segmentRows).map(
              orchestrationMessageFromProjectionRow,
            ),
            totalMessageCount: Math.min(messageCount.count, MAX_THREAD_MESSAGES),
          });
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

  const getThreadDetailById: ProjectionSnapshotQueryShape["getThreadDetailById"] = (threadId) =>
    sql.withTransaction(loadThreadDetail(threadId)).pipe(
      Effect.mapError((error) => {
        if (isPersistenceError(error)) {
          return error;
        }
        return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadDetailById:query")(error);
      }),
    );

  const getThreadDetailForExportById: ProjectionSnapshotQueryShape["getThreadDetailForExportById"] =
    (threadId) =>
      sql
        .withTransaction(
          loadThreadDetail(threadId, {
            messageLimit: null,
            tracePrefix: "ProjectionSnapshotQuery.getThreadDetailForExportById",
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            if (isPersistenceError(error)) {
              return error;
            }
            return toPersistenceSqlError(
              "ProjectionSnapshotQuery.getThreadDetailForExportById:query",
            )(error);
          }),
        );

  // Capture the projection cursor and thread detail in one transaction so the snapshot fence cannot
  // advance past the detail payload the client receives. Schema validation runs once, after the
  // transaction commits: the decode of a full transcript is CPU-bound and must not hold the shared
  // SQL connection.
  const getThreadDetailSnapshotById: ProjectionSnapshotQueryShape["getThreadDetailSnapshotById"] = (
    threadId,
  ) =>
    sql
      .withTransaction(
        Effect.all([
          loadThreadDetailRaw(threadId, {
            messageLimit: MAX_THREAD_MESSAGES,
            tracePrefix: "ProjectionSnapshotQuery.getThreadDetailSnapshotById",
          }),
          listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadDetailSnapshotById:listProjectionState:query",
                "ProjectionSnapshotQuery.getThreadDetailSnapshotById:listProjectionState:decodeRows",
              ),
            ),
          ),
        ]),
      )
      .pipe(
        Effect.flatMap(([threadDetail, stateRows]) => {
          if (Option.isNone(threadDetail)) {
            return Effect.succeed(Option.none<OrchestrationThreadDetailSnapshot>());
          }
          return computeSnapshotSequence(stateRows).pipe(
            Effect.flatMap((snapshotSequence) =>
              decodeThreadDetailSnapshot({
                snapshotSequence,
                thread: threadDetail.value,
              }).pipe(
                Effect.map((snapshot) => Option.some(snapshot)),
                Effect.mapError(
                  toPersistenceDecodeError(
                    "ProjectionSnapshotQuery.getThreadDetailSnapshotById:decodeSnapshot",
                  ),
                ),
              ),
            ),
          );
        }),
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadDetailSnapshotById:query")(
            error,
          );
        }),
      );
  return {
    getThreadDetailById,
    getThreadMentionContextById,
    getThreadDetailForExportById,
    getThreadDetailSnapshotById,
  };
}
