import type { TaggedFailure } from "../../platform/operationError.ts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ProviderRuntimeReconcilerShape {
  readonly reconcileNow: Effect.Effect<void, TaggedFailure>;
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ProviderRuntimeReconciler extends ServiceMap.Service<
  ProviderRuntimeReconciler,
  ProviderRuntimeReconcilerShape
>()("glade/provider/Services/ProviderRuntimeReconciler") {}
