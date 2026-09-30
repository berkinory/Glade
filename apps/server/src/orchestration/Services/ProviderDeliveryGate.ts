import { Effect, ServiceMap } from "effect";
import type { ProviderCommandReactorShape } from "./ProviderCommandReactor.ts";

export interface ProviderDeliveryGateShape {
  readonly isQuarantined: (threadId: string) => boolean;
  readonly quarantine: (threadId: string) => void;
  readonly releaseQuarantine: (threadId: string) => void;
  readonly markCompletionContext: (sequence: number) => void;
  readonly hasCompletionContext: (sequence: number) => boolean;
  readonly clearCompletionContext: (sequence: number) => void;
  readonly getReconciler: () => ProviderCommandReactorShape["reconcileDelivery"] | undefined;
  readonly setReconciler: (
    reconciler: ProviderCommandReactorShape["reconcileDelivery"],
  ) => Effect.Effect<void>;
  readonly withSourceLock: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class ProviderDeliveryGate extends ServiceMap.Service<
  ProviderDeliveryGate,
  ProviderDeliveryGateShape
>()("glade/orchestration/Services/ProviderDeliveryGate") {}
