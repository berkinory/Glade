import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "../core/baseSchemas";
import { ProviderKind } from "../core/baseSchemas";

export const GladeCapabilitiesInput = Schema.Struct({
  scope: Schema.optional(Schema.Literals(["all", "native-subagents"])),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const GladeListThreadsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  parentThreadId: Schema.optional(ThreadId),
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(
    Schema.Literals([
      "working",
      "idle",
      "error",
      "interrupted",
      "waiting-for-approval",
      "waiting-for-user-input",
    ]),
  ),
  titleContains: Schema.optional(TrimmedNonEmptyString),
  creationSource: Schema.optional(TrimmedNonEmptyString),
  updatedAfter: Schema.optional(IsoDateTime),
  updatedBefore: Schema.optional(IsoDateTime),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(100)),
  ),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type GladeListThreadsInput = typeof GladeListThreadsInput.Type;
