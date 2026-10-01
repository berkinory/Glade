import { Schema } from "effect";
import { MessageId, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";

export const WorkspaceRestoreConfirmation = Schema.Struct({
  fingerprint: TrimmedNonEmptyString,
  overwritePaths: Schema.Array(TrimmedNonEmptyString),
});
export type WorkspaceRestoreConfirmation = typeof WorkspaceRestoreConfirmation.Type;

export const WorkspaceRestorePreview = Schema.Struct({
  fingerprint: TrimmedNonEmptyString,
  files: Schema.Array(Schema.Struct({ path: TrimmedNonEmptyString, conflict: Schema.Boolean })),
});
export type WorkspaceRestorePreview = typeof WorkspaceRestorePreview.Type;

export const PreviewWorkspaceRestoreInput = Schema.Struct({
  threadId: ThreadId,
  target: Schema.Union([
    Schema.Struct({ type: Schema.Literal("edit"), messageId: MessageId }),
    Schema.Struct({ type: Schema.Literal("revert"), turnCount: NonNegativeInt }),
    Schema.Struct({ type: Schema.Literal("undoFiles"), turnCount: NonNegativeInt }),
  ]),
});
export type PreviewWorkspaceRestoreInput = typeof PreviewWorkspaceRestoreInput.Type;
