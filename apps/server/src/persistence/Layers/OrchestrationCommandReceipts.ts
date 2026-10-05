import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";

import {
  GetByCommandIdInput,
  NewOrchestrationCommandReceipt,
  OrchestrationCommandReceipt,
  OrchestrationCommandReceiptRepository,
  type OrchestrationCommandReceiptRepositoryShape,
} from "../Services/OrchestrationCommandReceipts.ts";

const makeOrchestrationCommandReceiptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertReceiptRow = SqlSchema.findOneOption({
    Request: NewOrchestrationCommandReceipt,
    Result: Schema.Struct({ commandId: Schema.String }),
    execute: (receipt) =>
      sql`
        INSERT INTO orchestration_command_receipts (
          command_id,
          aggregate_kind,
          aggregate_id,
          accepted_at,
          result_sequence,
          status,
          error,
          fingerprint_version,
          command_fingerprint,
          owner_kind,
          owner_id
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateKind},
          ${receipt.aggregateId},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${receipt.error},
          ${receipt.fingerprintVersion},
          ${receipt.commandFingerprint},
          ${receipt.ownerKind},
          ${receipt.ownerId}
        )
        ON CONFLICT (command_id)
        DO NOTHING
        RETURNING command_id AS "commandId"
      `,
  });

  const findReceiptByCommandId = SqlSchema.findOneOption({
    Request: GetByCommandIdInput,
    Result: OrchestrationCommandReceipt,
    execute: ({ commandId }) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_kind AS "aggregateKind",
          aggregate_id AS "aggregateId",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error,
          fingerprint_version AS "fingerprintVersion",
          command_fingerprint AS "commandFingerprint",
          owner_kind AS "ownerKind",
          owner_id AS "ownerId"
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
      `,
  });

  const insert: OrchestrationCommandReceiptRepositoryShape["insert"] = (receipt) =>
    insertReceiptRow(receipt).pipe(
      Effect.map(Option.isSome),
      Effect.mapError(toPersistenceSqlError("OrchestrationCommandReceiptRepository.insert:query")),
    );

  const getByCommandId: OrchestrationCommandReceiptRepositoryShape["getByCommandId"] = (input) =>
    findReceiptByCommandId(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("OrchestrationCommandReceiptRepository.getByCommandId:query"),
      ),
    );

  return {
    insert,
    getByCommandId,
  } satisfies OrchestrationCommandReceiptRepositoryShape;
});

export const OrchestrationCommandReceiptRepositoryLive = Layer.effect(
  OrchestrationCommandReceiptRepository,
  makeOrchestrationCommandReceiptRepository,
);
