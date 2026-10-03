import { Schema } from "effect";
import { MessageId, ThreadId, TurnId, TrimmedNonEmptyString } from "../core/baseSchemas";
import {
  OrchestrationGetTurnDiffInput,
  OrchestrationGetFullThreadDiffInput,
} from "../orchestration/rpc";

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PageFields = {
  offsetChars: Schema.optional(Offset),
  maxChars: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(2)).check(Schema.isLessThanOrEqualTo(20000)),
  ),
  version: Schema.optional(TrimmedNonEmptyString),
};
export const GladeReadTurnDiffInput = Schema.Struct({
  ...OrchestrationGetTurnDiffInput.fields,
  ...PageFields,
});
export const GladeReadThreadDiffInput = Schema.Struct({
  ...OrchestrationGetFullThreadDiffInput.fields,
  ...PageFields,
});
export const GladeForkThreadInput = Schema.Struct({
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  threadId: ThreadId,
  messageId: MessageId,
});
export const GladeRunDevServerInput = Schema.Struct({ command: TrimmedNonEmptyString });

export const GladeAppOpenInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: TrimmedNonEmptyString,
    line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  }),
  Schema.Struct({
    kind: Schema.Literal("diff"),
    turnId: Schema.optional(TurnId),
    path: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({ kind: Schema.Literal("terminal") }),
]);
export type GladeAppOpenInput = typeof GladeAppOpenInput.Type;
export const GladeAppOpenRequest = Schema.Struct({
  requestId: Schema.String,
  threadId: ThreadId,
  target: GladeAppOpenInput,
});
export type GladeAppOpenRequest = typeof GladeAppOpenRequest.Type;
export const GladeAppOpenAck = Schema.Struct({
  requestId: Schema.String,
  error: Schema.optional(Schema.String),
});
export type GladeAppOpenAck = typeof GladeAppOpenAck.Type;
