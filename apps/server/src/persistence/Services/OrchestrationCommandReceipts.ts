import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  SpaceId,
  ThreadId,
} from "@glade/contracts/core/baseSchemas";
import { OrchestrationAggregateKind } from "@glade/contracts/orchestration/events";
import { OrchestrationCommandReceiptStatus } from "@glade/contracts/orchestration/rpc";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { OrchestrationCommandReceiptRepositoryError } from "../Errors.ts";

const CommandFingerprint = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

const ReceiptFields = {
  commandId: CommandId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([SpaceId, ProjectId, ThreadId]),
  acceptedAt: IsoDateTime,
  resultSequence: NonNegativeInt,
  status: OrchestrationCommandReceiptStatus,
  error: Schema.NullOr(Schema.String),
  ownerKind: Schema.NullOr(Schema.Literals(["session", "local-loopback"])),
  ownerId: Schema.NullOr(Schema.String),
} as const;

export const OrchestrationCommandReceipt = Schema.Struct({
  ...ReceiptFields,
  fingerprintVersion: Schema.NullOr(PositiveInt),
  commandFingerprint: Schema.NullOr(CommandFingerprint),
});
export type OrchestrationCommandReceipt = typeof OrchestrationCommandReceipt.Type;

export const NewOrchestrationCommandReceipt = Schema.Struct({
  ...ReceiptFields,
  ownerKind: Schema.Literals(["session", "local-loopback"]),
  ownerId: Schema.String,
  fingerprintVersion: PositiveInt,
  commandFingerprint: CommandFingerprint,
});
export type NewOrchestrationCommandReceipt = typeof NewOrchestrationCommandReceipt.Type;

export const GetByCommandIdInput = Schema.Struct({
  commandId: CommandId,
});
export type GetByCommandIdInput = typeof GetByCommandIdInput.Type;

export interface OrchestrationCommandReceiptRepositoryShape {
  // Returns `false` when `commandId` already exists; callers must compare the stored fingerprint and
  // must never overwrite its original result.
  readonly insert: (
    receipt: NewOrchestrationCommandReceipt,
  ) => Effect.Effect<boolean, OrchestrationCommandReceiptRepositoryError>;

  readonly getByCommandId: (
    input: GetByCommandIdInput,
  ) => Effect.Effect<
    Option.Option<OrchestrationCommandReceipt>,
    OrchestrationCommandReceiptRepositoryError
  >;
}

export class OrchestrationCommandReceiptRepository extends ServiceMap.Service<
  OrchestrationCommandReceiptRepository,
  OrchestrationCommandReceiptRepositoryShape
>()(
  "glade/persistence/Services/OrchestrationCommandReceipts/OrchestrationCommandReceiptRepository",
) {}
