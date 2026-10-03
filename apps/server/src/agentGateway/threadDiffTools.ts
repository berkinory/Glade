import {
  GladeReadThreadDiffInput,
  GladeReadTurnDiffInput,
} from "@glade/contracts/provider/agentGatewayTools";
import { splitsSurrogatePair, unicodeSafeEndOffset } from "@glade/shared/text/text";
import { Effect, Schema, Semaphore } from "effect";
import type { CheckpointDiffQueryShape } from "../checkpointing/Services/CheckpointDiffQuery";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { stableGatewayDigest } from "./creationUtils";
import { mcpToolResultJson, mcpToolResultError, toolInputSchema } from "./protocol";
import { READ_ONLY_TOOL_ANNOTATIONS, type ToolEntry } from "./toolRuntime";
import { errorText, ToolInputError } from "./toolInput";

export function makeThreadDiffTools(
  diffs: CheckpointDiffQueryShape,
  snapshots: ProjectionSnapshotQueryShape,
): ReadonlyArray<ToolEntry> {
  const reads = Semaphore.makeUnsafe(2);
  return [
    {
      name: "glade_read_turn_diff",
      schema: GladeReadTurnDiffInput,
      description:
        "Read immutable checkpoint changes between fromTurnCount and toTurnCount. Use glade_read_thread checkpoint summaries for counts. Whitespace changes are included by default.",
    },
    {
      name: "glade_read_thread_diff",
      schema: GladeReadThreadDiffInput,
      description:
        "Read cumulative checkpoint changes through toTurnCount against the thread baseline. Use glade_read_thread checkpoint summaries for counts. Whitespace changes are included by default.",
    },
  ].map(({ name, schema, description }) => ({
    requiredCapability: "thread:read",
    definition: {
      name,
      description: `${description} Returns bounded text (default 12000 characters). Follow nextOffsetChars with the returned version and unchanged diff arguments; no next offset means complete.`,
      inputSchema: toolInputSchema(schema),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    handler: (args) =>
      Effect.gen(function* () {
        const input =
          name === "glade_read_turn_diff"
            ? Schema.decodeUnknownSync(GladeReadTurnDiffInput)(args)
            : Schema.decodeUnknownSync(GladeReadThreadDiffInput)(args);
        const exists = yield* snapshots.getThreadShellById(input.threadId);
        if (exists._tag === "None")
          return yield* Effect.fail(new ToolInputError("Thread not found."));
        if (
          "fromTurnCount" in input &&
          typeof input.fromTurnCount === "number" &&
          input.fromTurnCount > input.toTurnCount
        )
          return yield* Effect.fail(
            new ToolInputError("fromTurnCount must not exceed toTurnCount."),
          );
        const result =
          "fromTurnCount" in input && typeof input.fromTurnCount === "number"
            ? yield* diffs.getTurnDiff({
                threadId: input.threadId,
                fromTurnCount: input.fromTurnCount,
                toTurnCount: input.toTurnCount,
                ignoreWhitespace: input.ignoreWhitespace ?? false,
              })
            : yield* diffs.getFullThreadDiff({
                ...input,
                ignoreWhitespace: input.ignoreWhitespace ?? false,
              });
        const version = stableGatewayDigest(result);
        const offset = input.offsetChars ?? 0;
        if (
          (offset > 0 && input.version !== version) ||
          (input.version !== undefined && input.version !== version)
        )
          return yield* Effect.fail(
            new ToolInputError("Diff version changed. Restart at offsetChars 0."),
          );
        if (offset > result.diff.length || splitsSurrogatePair(result.diff, offset))
          return yield* Effect.fail(new ToolInputError("Invalid diff character offset."));
        const end = unicodeSafeEndOffset(
          result.diff,
          Math.min(result.diff.length, offset + (input.maxChars ?? 12000)),
        );
        return mcpToolResultJson({
          ...result,
          diff: result.diff.slice(offset, end),
          version,
          totalChars: result.diff.length,
          offsetChars: offset,
          nextOffsetChars: end < result.diff.length ? end : null,
        });
      }).pipe(
        reads.withPermit,
        Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
      ),
  }));
}
