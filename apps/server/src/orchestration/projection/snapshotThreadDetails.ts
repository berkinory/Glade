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
  type OrchestrationThreadWithoutActivities,
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
  const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>, tracePrefix: string) =>
    sql
      .withTransaction(effect)
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error) ? error : toPersistenceSqlError(`${tracePrefix}:query`)(error),
        ),
      );

  // Run inside a transaction so every part of the detail comes from one snapshot. The result is a thunk
  // so the CPU-bound assembly runs after the transaction releases the single shared connection.
  const loadThreadDetail = (
    threadId: ThreadId,
    options: {
      readonly messageLimit: number | null;
      readonly tracePrefix: string;
      readonly includeActivities: boolean;
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
        return Option.none<() => OrchestrationThread>();
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
        options.includeActivities
          ? listThreadActivityRowsByThread({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  `${options.tracePrefix}:listActivities:query`,
                  `${options.tracePrefix}:listActivities:decodeRows`,
                ),
              ),
            )
          : Effect.succeed([]),
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
      return Option.some((): OrchestrationThread => {
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
        // Without activities the derived request flags would miss requests that only the timeline
        // holds; the stored summary counts them.
        return options.includeActivities
          ? thread
          : {
              ...thread,
              hasPendingApprovals: threadRow.value.pendingApprovalCount > 0,
              hasPendingUserInput: threadRow.value.pendingUserInputCount > 0,
            };
      });
    });

  const readThreadDetail = (threadId: ThreadId, options: Parameters<typeof loadThreadDetail>[1]) =>
    inTransaction(loadThreadDetail(threadId, options), options.tracePrefix).pipe(
      Effect.map(Option.map((assemble) => assemble())),
    );

  const getThreadMentionContextById: ProjectionSnapshotQueryShape["getThreadMentionContextById"] = (
    threadId,
    options,
  ) => {
    const tracePrefix = "ProjectionSnapshotQuery.getThreadMentionContextById";
    return inTransaction(
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
      tracePrefix,
    );
  };

  const getThreadDetailById: ProjectionSnapshotQueryShape["getThreadDetailById"] = (threadId) =>
    readThreadDetail(threadId, {
      messageLimit: MAX_THREAD_MESSAGES,
      tracePrefix: "ProjectionSnapshotQuery.getThreadDetailById",
      includeActivities: true,
    });

  const getThreadDetailWithoutActivitiesById: ProjectionSnapshotQueryShape["getThreadDetailWithoutActivitiesById"] =
    (threadId) =>
      readThreadDetail(threadId, {
        messageLimit: MAX_THREAD_MESSAGES,
        tracePrefix: "ProjectionSnapshotQuery.getThreadDetailWithoutActivitiesById",
        includeActivities: false,
      }).pipe(
        Effect.map(
          Option.map(
            ({ activities: _activities, ...thread }): OrchestrationThreadWithoutActivities =>
              thread,
          ),
        ),
      );

  const getThreadDetailForExportById: ProjectionSnapshotQueryShape["getThreadDetailForExportById"] =
    (threadId) =>
      readThreadDetail(threadId, {
        messageLimit: null,
        tracePrefix: "ProjectionSnapshotQuery.getThreadDetailForExportById",
        includeActivities: true,
      });

  // Capture the projection cursor and thread detail in one transaction so the snapshot fence cannot
  // advance past the detail payload the client receives.
  const getThreadDetailSnapshotById: ProjectionSnapshotQueryShape["getThreadDetailSnapshotById"] = (
    threadId,
  ) => {
    const tracePrefix = "ProjectionSnapshotQuery.getThreadDetailSnapshotById";
    return inTransaction(
      Effect.all([
        loadThreadDetail(threadId, {
          messageLimit: MAX_THREAD_MESSAGES,
          tracePrefix,
          includeActivities: true,
        }),
        listProjectionStateRows(undefined).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${tracePrefix}:listProjectionState:query`,
              `${tracePrefix}:listProjectionState:decodeRows`,
            ),
          ),
        ),
      ]),
      tracePrefix,
    ).pipe(
      Effect.flatMap(([assembleDetail, stateRows]) => {
        if (Option.isNone(assembleDetail)) {
          return Effect.succeed(Option.none<OrchestrationThreadDetailSnapshot>());
        }
        return computeSnapshotSequence(stateRows).pipe(
          Effect.map((snapshotSequence) =>
            Option.some<OrchestrationThreadDetailSnapshot>({
              snapshotSequence,
              thread: assembleDetail.value(),
            }),
          ),
        );
      }),
    );
  };
  return {
    getThreadDetailById,
    getThreadDetailWithoutActivitiesById,
    getThreadMentionContextById,
    getThreadDetailForExportById,
    getThreadDetailSnapshotById,
  };
}
