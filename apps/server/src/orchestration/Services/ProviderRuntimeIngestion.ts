import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ProviderRuntimeIngestionShape {
  // The returned effect must be run in a scope so all worker fibers can be finalized on shutdown.
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  readonly reconcileSettledOpenTurns: Effect.Effect<void>;

  readonly drain: Effect.Effect<void>;
}

export class ProviderRuntimeIngestionService extends ServiceMap.Service<
  ProviderRuntimeIngestionService,
  ProviderRuntimeIngestionShape
>()("glade/orchestration/Services/ProviderRuntimeIngestion/ProviderRuntimeIngestionService") {}
