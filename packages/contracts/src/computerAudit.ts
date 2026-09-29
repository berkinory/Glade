import { Schema } from "effect";

import { IsoDateTime } from "./baseSchemas";

export const COMPUTER_AUDIT_HISTORY_MAX_LIMIT = 100;

const ComputerAuditIdentifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.:-]{1,128}$/));
const ComputerAuditCursor = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
);

export const ComputerAuditEffect = Schema.Literals([
  "verified",
  "dispatched-unknown",
  "not-dispatched",
  "refused",
  "error",
]);
export type ComputerAuditEffect = typeof ComputerAuditEffect.Type;

export const ComputerAuditHistoryEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ts: IsoDateTime,
  tool: Schema.String.check(Schema.isPattern(/^computer_[a-z_]{1,80}$/)),
  effect: ComputerAuditEffect,
  threadId: Schema.optional(ComputerAuditIdentifier),
  turnId: Schema.optional(ComputerAuditIdentifier),

  gatewayRequestId: Schema.optional(ComputerAuditIdentifier),
  code: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,95}$/))),
});
export type ComputerAuditHistoryEntry = typeof ComputerAuditHistoryEntry.Type;

export const ComputerGetAuditHistoryInput = Schema.Struct({
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: COMPUTER_AUDIT_HISTORY_MAX_LIMIT })),
  ),
  before: Schema.optional(ComputerAuditCursor),
});
export type ComputerGetAuditHistoryInput = typeof ComputerGetAuditHistoryInput.Type;

export const ComputerGetAuditHistoryResult = Schema.Struct({
  entries: Schema.Array(ComputerAuditHistoryEntry).check(
    Schema.isMaxLength(COMPUTER_AUDIT_HISTORY_MAX_LIMIT),
  ),
  nextCursor: Schema.NullOr(ComputerAuditCursor),

  truncated: Schema.Boolean,
  status: Schema.Literals(["available", "disabled", "missing"]),
});
export type ComputerGetAuditHistoryResult = typeof ComputerGetAuditHistoryResult.Type;
