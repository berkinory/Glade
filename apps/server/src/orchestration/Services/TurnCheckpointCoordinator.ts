// Revert admission and provider state checks cannot make a destructive restore safe on their own: a
// provider turn may activate after the final check.
// Revert admission and provider state checks cannot make a destructive restore safe on their own: a
// provider turn may activate after the final check.
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect } from "effect";

export interface TurnCheckpointCoordinatorShape {
  readonly withThreadLease: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class TurnCheckpointCoordinator extends ServiceMap.Service<
  TurnCheckpointCoordinator,
  TurnCheckpointCoordinatorShape
>()("glade/orchestration/Services/TurnCheckpointCoordinator") {}
