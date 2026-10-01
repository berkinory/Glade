import { Effect } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert } from "@effect/vitest";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./projectorRegistration.ts";
import { projectionSnapshotLayer } from "./snapshotTestFixtures";

projectionSnapshotLayer("Projection snapshot cursorFences", (it) => {
  it.effect("reports snapshot sequence 0 for an empty projection cursor table", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM projection_state`;

      const { snapshotSequence } = yield* snapshotQuery.getSnapshotSequence();
      assert.equal(snapshotSequence, 0);
    }),
  );

  it.effect("fails with ProjectionStateIncompleteError when a required cursor row is missing", () =>
    Effect.gen(function* () {
      // Regression for the permanent resnapshot loop: a non-empty cursor table missing projection.hot (an
      // interrupted repair leaves exactly this shape) used to read as snapshot sequence 0, which the
      // stream layer interpreted as "high-water events behind" forever. It must be a typed, diagnosable
      // failure instead of a silent 0.
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM projection_state`;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        if (projector === ORCHESTRATION_PROJECTOR_NAMES.hot) continue;
        yield* sql`
            INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
            VALUES (${projector}, 953667, '2026-08-11T00:00:00.000Z')
          `;
      }

      const outcome = yield* Effect.exit(snapshotQuery.getSnapshotSequence());
      assert.equal(outcome._tag, "Failure");
      if (outcome._tag === "Failure") {
        const failure = outcome.cause.reasons[0];
        assert.ok(failure && "error" in failure);
        const error = (failure as { readonly error: unknown }).error as {
          readonly _tag: string;
          readonly missingProjectors: ReadonlyArray<string>;
        };
        assert.equal(error._tag, "ProjectionStateIncompleteError");
        assert.deepEqual(error.missingProjectors, [ORCHESTRATION_PROJECTOR_NAMES.hot]);
      }

      yield* sql`DELETE FROM projection_state`;
    }),
  );

  it.effect("derives the snapshot sequence from the minimum required cursor", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES
          (${ORCHESTRATION_PROJECTOR_NAMES.hot}, 42, '2026-08-11T00:00:00.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries}, 7, '2026-08-11T00:00:00.000Z')
      `;

      const { snapshotSequence } = yield* snapshotQuery.getSnapshotSequence();
      assert.equal(snapshotSequence, 7);

      yield* sql`DELETE FROM projection_state`;
    }),
  );
});
