import type { TaggedFailure } from "../../platform/operationError.ts";

import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  ProviderBlockingDeliveryEvidence,
  ProviderDeliveryReconciliationOutcome,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";

interface ProviderDeliveryReconciliationResult {
  readonly eventSequence: number;
  readonly threadId: ThreadId;
  readonly outcome: ProviderDeliveryReconciliationOutcome;
  readonly state: "retry" | "succeeded" | "dead" | "uncertain";
  readonly reconciledAt: string;
}

export interface ProviderCommandReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  readonly drain: Effect.Effect<void>;

  readonly listBlockingDeliveries: (input: {
    readonly threadId?: string | undefined;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ProviderBlockingDeliveryEvidence>, TaggedFailure>;

  readonly reconcileDelivery: (input: {
    readonly eventSequence: number;
    readonly threadId: ThreadId;
    readonly expectedState: "dead" | "uncertain";
    readonly outcome: ProviderDeliveryReconciliationOutcome;
    readonly reconciledBy: string;
    readonly note?: string | undefined;
  }) => Effect.Effect<ProviderDeliveryReconciliationResult | null, TaggedFailure>;
}

export class ProviderCommandReactor extends ServiceMap.Service<
  ProviderCommandReactor,
  ProviderCommandReactorShape
>()("glade/orchestration/Services/ProviderCommandReactor") {}
