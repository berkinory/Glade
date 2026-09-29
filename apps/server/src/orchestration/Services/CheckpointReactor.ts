import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface CheckpointReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  readonly drain: Effect.Effect<void>;
}

export class CheckpointReactor extends ServiceMap.Service<
  CheckpointReactor,
  CheckpointReactorShape
>()("glade/orchestration/Services/CheckpointReactor") {}
