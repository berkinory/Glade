import { readNativeMessageReferences } from "./nativeMessageReferences";
import { Effect, Option } from "effect";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { OrchestrationThreadDetailSnapshot } from "@glade/contracts/orchestration/snapshots";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  toPersistenceSqlOrDecodeError,
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
  toProjectedActivity,
  toProjectedCheckpoint,
  toProjectedSession,
} from "./snapshotAssembly";
import { computeSnapshotSequence } from "./snapshotCursor";

export function makeSnapshotThreadDetails(input: {
  readonly getThreadRowById: ReturnType<typeof makeSnapshotThreadQueries>["getThreadRowById"];
  readonly listThreadMessageRowsByThread: ReturnType<
    typeof makeSnapshotMessageQueries
  >["listThreadMessageRowsByThread"];

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
  const loadThreadDetail = (
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
        return Option.none<OrchestrationThread>();
      }

      const [
        messageRows,

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

      const messagesWithNativeReferences = yield* readNativeMessageReferences(sql, messageRows);
      const segmentRows = yield* loadMessageSegments(messageRows, options.tracePrefix);
      const thread = toProjectedThread({
        threadRow: threadRow.value,
        latestTurn: Option.match(latestTurnRow, {
          onNone: () => null,
          onSome: (row) => toProjectedLatestTurn(row),
        }),
        messages: attachThreadMessageSegments(messagesWithNativeReferences, segmentRows).map(
          orchestrationMessageFromProjectionRow,
        ),

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
          const messagesWithNativeReferences = yield* readNativeMessageReferences(sql, messageRows);
          const segmentRows = yield* loadMessageSegments(messageRows, tracePrefix);
          return Option.some<OrchestrationThreadMentionContext>({
            id: threadRow.value.threadId,
            title: threadRow.value.title,
            modelSelection: threadRow.value.modelSelection,
            messages: attachThreadMessageSegments(messagesWithNativeReferences, segmentRows).map(
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
  // advance past the detail payload the client receives.
  const getThreadDetailSnapshotById: ProjectionSnapshotQueryShape["getThreadDetailSnapshotById"] = (
    threadId,
  ) =>
    sql
      .withTransaction(
        Effect.all([
          loadThreadDetail(threadId, {
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
            Effect.map((snapshotSequence) =>
              Option.some<OrchestrationThreadDetailSnapshot>({
                snapshotSequence,
                thread: threadDetail.value,
              }),
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
