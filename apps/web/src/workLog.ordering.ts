import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { isContextCompactionProgressLabel } from "./workLog.reconciliation";
import type { TimelineEntry } from "./workLog.types";

// Code-unit order matches chronological order for the fixed-width ISO-8601 timestamps the server emits,
// and costs far less than a locale collation in these hot sorts.
export function compareIsoTimestamps(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = compareIsoTimestamps(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  // Compaction progress and terminal rows can share a millisecond; keep the progress row first so the
  // work-log collapse can fold the pair (event ids are random and would otherwise order them
  // arbitrarily).
  if (left.kind === "context-compaction" && right.kind === "context-compaction") {
    const compactionRankComparison =
      contextCompactionOrderRank(left.summary) - contextCompactionOrderRank(right.summary);
    if (compactionRankComparison !== 0) {
      return compactionRankComparison;
    }
  }

  return left.id.localeCompare(right.id);
}

function contextCompactionOrderRank(summary: string): number {
  return isContextCompactionProgressLabel(summary) ? 0 : 1;
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

// Time first: `sequence` mixes the provider journal counter with the orchestration event counter, and
// messages carry none. The timeline merge needs both lists sorted by the same key, so sequence only
// breaks same-time ties; sequence-first let one server row with a low sequence lead its block's work
// and pushed every message of the block above that work.
export function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  const createdAtComparison = compareIsoTimestamps(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  if (
    "sequence" in left &&
    "sequence" in right &&
    left.sequence !== undefined &&
    right.sequence !== undefined
  ) {
    return left.sequence - right.sequence;
  }
  return 0;
}
