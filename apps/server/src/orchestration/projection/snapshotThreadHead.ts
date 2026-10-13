import { Effect, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { MessageId, NonNegativeInt, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadDetailHead } from "@glade/contracts/orchestration/snapshots";
import { THREAD_DETAIL_EVENT_TYPES } from "@glade/shared/threads/threadDetailEvents";
import {
  isPersistenceError,
  toPersistenceSqlError,
  toPersistenceSqlOrDecodeError,
} from "../../persistence/Errors.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import type { makeSnapshotBaseQueries } from "./snapshotBaseQueries";
import type { makeSnapshotHistoryQueries } from "./snapshotHistoryQueries";
import { toProjectedLatestTurn, toProjectedSession } from "./snapshotAssembly";
import { computeSnapshotSequence } from "./snapshotCursor";

const TRACE = "ProjectionSnapshotQuery.getThreadDetailHeadById";

const ThreadHeadRequest = Schema.Struct({
  threadId: ThreadId,
  throughSequence: NonNegativeInt,
  assistantMessageId: Schema.NullOr(MessageId),
  latestTurnId: Schema.NullOr(TurnId),
});

export function makeSnapshotThreadHead(input: {
  readonly sql: SqlClient.SqlClient;
  readonly listProjectionStateRows: ReturnType<
    typeof makeSnapshotBaseQueries
  >["listProjectionStateRows"];
  readonly getLatestTurnRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getLatestTurnRowByThread"];
  readonly getThreadSessionRowByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["getThreadSessionRowByThread"];
  readonly listPendingInteractionRowsByThread: ReturnType<
    typeof makeSnapshotHistoryQueries
  >["listPendingInteractionRowsByThread"];
}) {
  const { sql } = input;

  // `+event_type` keeps the planner on the (aggregate_kind, stream_id, sequence) index, so this reads
  // backwards from the newest event instead of every detail event of the thread.
  const readThreadHeadRow = SqlSchema.findOneOption({
    Request: ThreadHeadRequest,
    Result: Schema.Struct({
      detailSequence: NonNegativeInt,
      assistantMessageStored: Schema.Number,
      latestTurnMessageCount: NonNegativeInt,
      latestTurnActivityCount: NonNegativeInt,
    }),
    execute: ({ threadId, throughSequence, assistantMessageId, latestTurnId }) => sql`
      SELECT
        COALESCE((
          SELECT sequence
          FROM orchestration_events
          WHERE aggregate_kind = 'thread'
            AND stream_id = ${threadId}
            AND sequence <= ${throughSequence}
            AND +event_type IN ${sql.in(THREAD_DETAIL_EVENT_TYPES)}
          ORDER BY sequence DESC
          LIMIT 1
        ), 0) AS "detailSequence",
        EXISTS (
          SELECT 1
          FROM projection_thread_messages
          WHERE thread_id = ${threadId} AND message_id = ${assistantMessageId}
        ) AS "assistantMessageStored",
        (
          SELECT COUNT(*)
          FROM projection_thread_messages
          WHERE thread_id = ${threadId} AND turn_id = ${latestTurnId}
        ) AS "latestTurnMessageCount",
        (
          SELECT COUNT(*)
          FROM projection_thread_activities
          WHERE thread_id = ${threadId} AND turn_id = ${latestTurnId}
        ) AS "latestTurnActivityCount"
      FROM projection_threads
      WHERE thread_id = ${threadId}
        AND deleted_at IS NULL
    `,
  });

  const listStreamingMessageIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: Schema.Struct({ messageId: MessageId }),
    execute: ({ threadId }) => sql`
      SELECT message_id AS "messageId"
      FROM projection_thread_messages
      WHERE thread_id = ${threadId}
        AND is_streaming = 1
      ORDER BY created_at ASC, message_id ASC
    `,
  });

  const readHead = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const stateRows = yield* input
        .listProjectionStateRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${TRACE}:listProjectionState:query`,
              `${TRACE}:listProjectionState:decodeRows`,
            ),
          ),
        );
      const snapshotSequence = yield* computeSnapshotSequence(stateRows);
      const [latestTurnRow, sessionRow, pendingInteractions, streamingRows] = yield* Effect.all([
        input
          .getLatestTurnRowByThread({ threadId })
          .pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                `${TRACE}:getLatestTurn:query`,
                `${TRACE}:getLatestTurn:decodeRow`,
              ),
            ),
          ),
        input
          .getThreadSessionRowByThread({ threadId })
          .pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                `${TRACE}:getSession:query`,
                `${TRACE}:getSession:decodeRow`,
              ),
            ),
          ),
        input
          .listPendingInteractionRowsByThread({ threadId })
          .pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                `${TRACE}:listPendingInteractions:query`,
                `${TRACE}:listPendingInteractions:decodeRows`,
              ),
            ),
          ),
        listStreamingMessageIdRows({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${TRACE}:listStreamingMessages:query`,
              `${TRACE}:listStreamingMessages:decodeRows`,
            ),
          ),
        ),
      ]);
      const latestTurn = Option.match(latestTurnRow, {
        onNone: () => null,
        onSome: toProjectedLatestTurn,
      });
      const headRow = yield* readThreadHeadRow({
        threadId,
        throughSequence: snapshotSequence,
        assistantMessageId: latestTurn?.assistantMessageId ?? null,
        latestTurnId: latestTurn?.turnId ?? null,
      }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(`${TRACE}:readHead:query`, `${TRACE}:readHead:decodeRow`),
        ),
      );
      return Option.map(
        headRow,
        (row): OrchestrationThreadDetailHead => ({
          snapshotSequence,
          detailSequence: row.detailSequence,
          session: Option.match(sessionRow, { onNone: () => null, onSome: toProjectedSession }),
          latestTurn,
          latestTurnAssistantMessageStored: row.assistantMessageStored === 1,
          latestTurnMessageCount: row.latestTurnMessageCount,
          latestTurnActivityCount: row.latestTurnActivityCount,
          streamingMessageIds: streamingRows.map((streamingRow) => streamingRow.messageId),
          pendingInteractions,
        }),
      );
    });

  const getThreadDetailHeadById: ProjectionSnapshotQueryShape["getThreadDetailHeadById"] = (
    threadId,
  ) =>
    sql
      .withTransaction(readHead(threadId))
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error) ? error : toPersistenceSqlError(`${TRACE}:query`)(error),
        ),
      );

  return { getThreadDetailHeadById };
}
