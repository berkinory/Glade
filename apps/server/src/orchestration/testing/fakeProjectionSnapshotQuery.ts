import { Effect } from "effect";

import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";

export function fakeProjectionSnapshotQuery(
  overrides: Partial<ProjectionSnapshotQueryShape> = {},
): ProjectionSnapshotQueryShape {
  const unused = (): never => Effect.die("unused") as never;
  return {
    getCommandReadModel: unused,
    getSnapshot: unused,
    getCounts: unused,
    getSnapshotSequence: unused,
    listStaleInFlightThreadIds: unused,
    listManagedWorktreeThreads: unused,
    getShellSnapshot: unused,
    getActiveProjectByWorkspaceRoot: unused,
    getProjectShellById: unused,
    getSpaceShellById: unused,
    getFirstActiveThreadIdByProjectId: unused,
    getThreadCheckpointContext: unused,
    listGeneratedImageActivitiesByTurn: unused,
    getFullThreadDiffContext: unused,
    getThreadShellById: unused,
    getThreadShellsByIds: unused,
    listChildThreadShells: unused,
    threadIdExistsIncludingDeleted: unused,
    findSyntheticSubagentParentThread: unused,
    getThreadDetailById: unused,
    getThreadMentionContextById: unused,
    getThreadDetailForExportById: unused,
    getThreadDetailSnapshotById: unused,
    ...overrides,
  };
}
