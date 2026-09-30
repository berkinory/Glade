import { Schema } from "effect";
import type { CodexModelSelection } from "@glade/contracts/provider/sessionPolicy";

const ThreadSettings = Schema.Struct({
  threadSettings: Schema.Struct({
    model: Schema.String,
    effort: Schema.optional(Schema.NullOr(Schema.String)),
    serviceTier: Schema.optional(Schema.NullOr(Schema.String)),
  }),
});

const FilePatch = Schema.Struct({
  itemId: Schema.String,
  changes: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      diff: Schema.String,
      kind: Schema.Union([
        Schema.Struct({ type: Schema.Literal("add") }),
        Schema.Struct({ type: Schema.Literal("delete") }),
        Schema.Struct({
          type: Schema.Literal("update"),
          move_path: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ]),
    }),
  ),
});

const ApprovalReview = Schema.Struct({ reviewId: Schema.String });

export function codexUpdatedModelSelection(value: unknown): CodexModelSelection {
  const { threadSettings } = Schema.decodeUnknownSync(ThreadSettings)(value);
  return {
    provider: "codex",
    model: threadSettings.model,
    options: {
      ...(threadSettings.effort ? { reasoningEffort: threadSettings.effort } : {}),
      ...(threadSettings.serviceTier ? { serviceTier: threadSettings.serviceTier } : {}),
    },
  };
}

export const decodeCodexFilePatch = Schema.decodeUnknownSync(FilePatch);
export const decodeCodexApprovalReview = Schema.decodeUnknownSync(ApprovalReview);
