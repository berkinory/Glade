import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { NonNegativeInt, ThreadId, EventId } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceSqlError, toPersistenceSqlOrDecodeError } from "../Errors.ts";

import {
  DeleteProjectionThreadActivitiesInput,
  ListProjectionActivitiesByKindsInput,
  ListProjectionThreadActivitiesInput,
  ProjectionThreadActivity,
  ProjectionThreadActivityRepository,
  type ProjectionThreadActivityRepositoryShape,
} from "../Services/ProjectionThreadActivities.ts";

const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);

const toProjectionThreadActivity = ({
  sequence,
  ...row
}: typeof ProjectionThreadActivityDbRowSchema.Type): ProjectionThreadActivity => ({
  ...row,
  ...(sequence !== null ? { sequence } : {}),
});

const makeProjectionThreadActivityRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadActivityRow = SqlSchema.void({
    Request: ProjectionThreadActivity,
    execute: (row) =>
      sql`
            INSERT INTO projection_thread_activities (
              activity_id,
              thread_id,
              turn_id,
              tone,
              kind,
              summary,
              payload_json,
              sequence,
              created_at
            )
            VALUES (
              ${row.activityId},
              ${row.threadId},
              ${row.turnId},
              ${row.tone},
              ${row.kind},
              ${row.summary},
              ${JSON.stringify(row.payload)},
              ${row.sequence ?? null},
              ${row.createdAt}
            )
            ON CONFLICT (activity_id)
            DO UPDATE SET
              thread_id = excluded.thread_id,
              turn_id = excluded.turn_id,
              tone = excluded.tone,
              kind = excluded.kind,
              summary = excluded.summary,
              payload_json = excluded.payload_json,
              sequence = CASE WHEN excluded.kind = 'provider.transition' THEN projection_thread_activities.sequence ELSE excluded.sequence END,
              created_at = excluded.created_at
          `,
  });

  const getProjectionThreadActivityRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId, activityId: EventId }),
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId, activityId }) => sql`
      SELECT activity_id AS "activityId", thread_id AS "threadId", turn_id AS "turnId",
        tone, kind, summary, payload_json AS "payload", sequence, created_at AS "createdAt"
      FROM projection_thread_activities WHERE thread_id = ${threadId} AND activity_id = ${activityId}
    `,
  });
  const getById: ProjectionThreadActivityRepositoryShape["getById"] = (input) =>
    getProjectionThreadActivityRow(input).pipe(
      Effect.map(Option.map(toProjectionThreadActivity)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadActivityRepository.getById:query",
          "ProjectionThreadActivityRepository.getById:decode",
        ),
      ),
    );

  const listProjectionThreadActivityRows = SqlSchema.findAll({
    Request: ListProjectionThreadActivitiesInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listProjectionActivityRowsByKinds = SqlSchema.findAll({
    Request: ListProjectionActivitiesByKindsInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ kinds, createdSince }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE kind IN ${sql.in(kinds)} AND created_at >= ${createdSince}
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const deleteProjectionThreadActivityRows = SqlSchema.void({
    Request: DeleteProjectionThreadActivitiesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadActivityRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadActivityRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadActivityRepository.upsert:query",
          "ProjectionThreadActivityRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ProjectionThreadActivityRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadActivityRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadActivityRepository.listByThreadId:query",
          "ProjectionThreadActivityRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadActivity)),
    );

  const listByKinds: ProjectionThreadActivityRepositoryShape["listByKinds"] = (input) =>
    listProjectionActivityRowsByKinds(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadActivityRepository.listByKinds:query",
          "ProjectionThreadActivityRepository.listByKinds:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadActivity)),
    );

  const deleteByThreadId: ProjectionThreadActivityRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadActivityRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadActivityRepository.deleteByThreadId:query"),
      ),
    );

  return {
    getById,
    upsert,
    listByThreadId,
    listByKinds,
    deleteByThreadId,
  } satisfies ProjectionThreadActivityRepositoryShape;
});

export const ProjectionThreadActivityRepositoryLive = Layer.effect(
  ProjectionThreadActivityRepository,
  makeProjectionThreadActivityRepository,
);
