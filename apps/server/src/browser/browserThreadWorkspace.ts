import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

// The folder browser downloads and uploads of this thread resolve against, or null without one.
export const browserThreadWorkspace = (
  snapshots: ProjectionSnapshotQueryShape,
  threadId: ThreadId,
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const thread = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(thread)) return null;
    const project = yield* snapshots.getProjectShellById(thread.value.projectId);
    return (
      resolveThreadWorkspaceCwd({
        thread: thread.value,
        projects: Option.isSome(project) ? [project.value] : [],
      }) ?? null
    );
  }).pipe(Effect.catch(() => Effect.succeed(null)));
