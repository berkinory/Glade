import type { ThreadId } from "@glade/contracts";
import { Effect, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";

export function resolveProviderSessionThread(
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  threadId: ThreadId,
) {
  return Effect.gen(function* () {
    const thread = Option.getOrNull(yield* projectionSnapshotQuery.getThreadShellById(threadId));
    if (thread === null) {
      return null;
    }
    if (thread.parentThreadId) {
      return (
        Option.getOrNull(
          yield* projectionSnapshotQuery.getThreadShellById(thread.parentThreadId),
        ) ?? thread
      );
    }
    if (!(thread.id as string).startsWith("subagent:")) {
      return thread;
    }
    return (
      Option.getOrNull(
        yield* projectionSnapshotQuery.findSyntheticSubagentParentThread(thread.id),
      ) ?? thread
    );
  });
}
