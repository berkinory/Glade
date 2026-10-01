import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { Schema, Effect } from "effect";
import { ProjectionStateIncompleteError } from "../../persistence/Errors.ts";
import { ProjectionStateDbRowSchema } from "./snapshotSchemas";

export const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.hot,
  ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
] as const;

export // An empty cursor table is a fresh database, whose fence is legitimately 0. A non-empty table
// missing a required cursor is a different situation entirely: the fence is unknown, and mapping it
// to 0 would report the snapshot as "high-water events behind" forever — every stream (re)start
// would demand a resnapshot that can never succeed. That state is only reachable through an
// interrupted projection repair, so it fails with a typed ProjectionStateIncompleteError instead of
// silently degrading. The projection bootstrap reconstructs the hot cursor on startup (see
// initializeHotProjectionCursor), so the error also self-heals on restart.
function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): Effect.Effect<number, ProjectionStateIncompleteError> {
  if (stateRows.length === 0) {
    return Effect.succeed(0);
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  const missingProjectors: string[] = [];
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      missingProjectors.push(projector);
      continue;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }
  if (missingProjectors.length > 0) {
    return Effect.fail(
      new ProjectionStateIncompleteError({
        missingProjectors,
        knownProjectors: stateRows.map((row) => row.projector),
      }),
    );
  }

  return Effect.succeed(Number.isFinite(minSequence) ? minSequence : 0);
}
