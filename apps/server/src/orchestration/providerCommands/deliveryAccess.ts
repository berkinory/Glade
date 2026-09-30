import type { ServiceMap } from "effect";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { Ref, Effect, Option, Duration } from "effect";
import { type ProviderCommandReactorShape } from "../Services/ProviderCommandReactor.ts";
import { ProviderCommandExecutionError } from "./providerCallPolicy";

export function makeProviderDeliveryAccess(input: {
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly deliveryRepository: ServiceMap.Service.Shape<
    typeof OrchestrationEventDeliveryRepository
  >;
  readonly deliveryReconciler: Ref.Ref<
    ProviderCommandReactorShape["reconcileDelivery"] | undefined
  >;
}): Pick<ProviderCommandReactorShape, "reconcileDelivery" | "drain" | "listBlockingDeliveries"> {
  const { orchestrationEngine, deliveryRepository, deliveryReconciler } = input;
  const drain: ProviderCommandReactorShape["drain"] = Effect.gen(function* () {
    const targetSequence = yield* orchestrationEngine.getEventHighWaterSequence;
    while (true) {
      const consumerState = yield* deliveryRepository.getConsumerState(
        PROVIDER_COMMAND_REACTOR_CONSUMER,
      );
      if (Option.isSome(consumerState) && consumerState.value.lastAckedSequence >= targetSequence) {
        return;
      }
      yield* Effect.sleep(Duration.millis(5));
    }
  }).pipe(Effect.orDie);

  const listBlockingDeliveries: ProviderCommandReactorShape["listBlockingDeliveries"] = (input) =>
    deliveryRepository.listBlockingDeliveries({
      consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      limit: Math.max(1, Math.min(100, input.limit)),
    });

  const reconcileDelivery: ProviderCommandReactorShape["reconcileDelivery"] = (input) =>
    Effect.flatMap(Ref.get(deliveryReconciler), (runtime) =>
      runtime === undefined
        ? Effect.fail(
            new ProviderCommandExecutionError("Provider delivery reconciliation is not ready"),
          )
        : runtime(input),
    );
  return { reconcileDelivery, drain, listBlockingDeliveries };
}
