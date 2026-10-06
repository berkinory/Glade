import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";

export const VISUAL_REPLY_ACTIVITY_KIND = "visual-reply.published";
export const VISUAL_REPLY_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const VISUAL_REPLY_MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const VISUAL_REPLY_ROUTE = "/api/visual-reply";

const FrameHeight = Schema.Int.check(Schema.isBetween({ minimum: 80, maximum: 2000 }));
const MeasuredHeights = Schema.Array(
  Schema.Tuple([
    Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 1600 })),
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ]),
).check(Schema.isMaxLength(9));

const ManagedId = TrimmedNonEmptyString.check(Schema.isPattern(/^att_v2_[0-9a-f]{32}$/u));

export const VisualReply = Schema.Struct({
  version: Schema.Literal(1),
  height: Schema.optional(FrameHeight),
  heights: Schema.optional(MeasuredHeights),
  threadId: ThreadId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  attachmentId: ManagedId,
  previewAttachmentId: Schema.optional(ManagedId),
});
export type VisualReply = typeof VisualReply.Type;

export const VisualReplyInput = Schema.Struct({
  height: FrameHeight,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  html: Schema.optional(Schema.String.check(Schema.isMaxLength(VISUAL_REPLY_MAX_SOURCE_BYTES))),
  path: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
  previewAttachmentId: Schema.optional(ManagedId),
});
export type VisualReplyInput = typeof VisualReplyInput.Type;

export const VisualReplyPreviewInput = Schema.Struct({
  ...VisualReplyInput.fields,
  appearance: Schema.optional(Schema.Literals(["light", "dark"])),
  width: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 320, maximum: 1600 }))),
  height: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 1200 }))),
});
export type VisualReplyPreviewInput = typeof VisualReplyPreviewInput.Type;
