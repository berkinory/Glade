import { Effect, Layer } from "effect";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TurnCheckpointCoordinator } from "../Services/TurnCheckpointCoordinator.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderProjectionAccess } from "../Services/ProviderProjectionAccess.ts";
import { makeProviderProjectionAccess } from "../providerCommands/projectionAccess.ts";

export const ProviderProjectionAccessLive = Layer.effect(
  ProviderProjectionAccess,
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const turnCheckpointCoordinator = yield* TurnCheckpointCoordinator;
    const providerService = yield* ProviderService;
    return makeProviderProjectionAccess({
      projectionSnapshotQuery,
      turnCheckpointCoordinator,
      providerService,
    });
  }),
);
