import { Schema } from "effect";
import { NonNegativeInt, ThreadId } from "../core/baseSchemas";

export const GitLocalWorktreeInput = Schema.Struct({ threadId: ThreadId });
export type GitLocalWorktreeInput = typeof GitLocalWorktreeInput.Type;

export const GitLocalWorktreeActionInput = Schema.Struct({
  threadId: ThreadId,
  action: Schema.Literals(["update", "merge", "sync"]),
  targetBranch: Schema.optional(Schema.String),
  commit: Schema.optional(
    Schema.Struct({
      message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
      snapshot: Schema.String,
      scope: Schema.Literals(["staged", "workingTree"]),
    }),
  ),
});
export type GitLocalWorktreeActionInput = typeof GitLocalWorktreeActionInput.Type;

export const GitLocalWorktreeState = Schema.Struct({
  cwd: Schema.String,
  branch: Schema.NullOr(Schema.String),
  targetCwd: Schema.String,
  targetBranch: Schema.NullOr(Schema.String),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  clean: Schema.Boolean,
  blockedReason: Schema.NullOr(Schema.String),
});
export type GitLocalWorktreeState = typeof GitLocalWorktreeState.Type;
