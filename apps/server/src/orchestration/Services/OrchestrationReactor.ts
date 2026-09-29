import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface OrchestrationReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  readonly reconcileSettledOpenTurns: Effect.Effect<void>;
}

export class OrchestrationReactor extends ServiceMap.Service<
  OrchestrationReactor,
  OrchestrationReactorShape
>()("glade/orchestration/Services/OrchestrationReactor") {}
