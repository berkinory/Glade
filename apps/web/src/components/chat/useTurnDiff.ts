import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useQuery } from "@tanstack/react-query";
import type { FileDiffMetadata } from "@pierre/diffs";
import {
  getRenderablePatch,
  resolveDiffEntryByPath,
  resolveFileDiffPath,
  type RenderablePatch,
} from "~/lib/diffRendering";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { inferCheckpointTurnCountByTurnId } from "~/session-logic";
import { useStore } from "~/store";
import { selectThreadTurnDiffSummaries } from "~/threadDerivation";

/** A turn's changes from its checkpoints: its summary, its checkpoint and its parsed patch. */
export function useTurnDiff(input: { threadId: ThreadId; turnId: TurnId }) {
  const summaries = useStore((state) => selectThreadTurnDiffSummaries(state, input.threadId));
  const turn = summaries.find((summary) => summary.turnId === input.turnId);
  const count =
    turn?.checkpointTurnCount ?? inferCheckpointTurnCountByTurnId(summaries)[input.turnId];
  const query = useQuery(
    checkpointDiffQueryOptions({
      threadId: input.threadId,
      fromTurnCount: count === undefined ? null : Math.max(0, count - 1),
      toTurnCount: count ?? null,
      ignoreWhitespace: false,
      cacheScope: `turn:${input.turnId}`,
      live: false,
      enabled: count !== undefined,
    }),
  );
  const patch = getRenderablePatch(query.data?.diff, `turn:${input.turnId}`);
  return { turn, count, query, patch };
}

// Tool rows name files the way the tool did, often as absolute paths; the diff holds repo-relative
// ones, so the two are matched by path suffix.
export function findPatchFile(
  patch: RenderablePatch | null,
  filePath: string,
): FileDiffMetadata | null {
  if (patch?.kind !== "files") return null;
  return (
    resolveDiffEntryByPath(
      new Map(patch.files.map((file) => [resolveFileDiffPath(file), file])),
      filePath,
    ) ?? null
  );
}
