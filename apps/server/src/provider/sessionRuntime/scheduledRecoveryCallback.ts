import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ServiceMap } from "effect";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { Scope, Effect, Option, Cause } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { runtimeEventRetiredGatewayTurnAuthority } from "../core/providerRuntimeBinding";
import { makeProviderSessionRecovery } from "./sessionRecovery";

export function makeProviderScheduledRecoveryCallback(input: {
  readonly retiredGatewaySessionRecoveries: Set<ThreadId>;
  readonly directory: ServiceMap.Service.Shape<typeof ProviderSessionDirectory>;
  readonly recoverSessionForThread: ReturnType<
    typeof makeProviderSessionRecovery
  >["recoverSessionForThread"];
  readonly runtimeEventProducerScope: Scope.Closeable;
}): (event: ProviderRuntimeEvent) => Effect.Effect<void> {
  const {
    retiredGatewaySessionRecoveries,
    directory,
    recoverSessionForThread,
    runtimeEventProducerScope,
  } = input;
  return (event) => {
    if (
      (event.type !== "turn.completed" && event.type !== "turn.aborted") ||
      !runtimeEventRetiredGatewayTurnAuthority(event)
    ) {
      return Effect.void;
    }

    return Effect.suspend(() => {
      if (retiredGatewaySessionRecoveries.has(event.threadId)) {
        return Effect.void;
      }
      retiredGatewaySessionRecoveries.add(event.threadId);

      return Effect.gen(function* () {
        yield* Effect.yieldNow;
        const binding = Option.getOrUndefined(yield* directory.getBinding(event.threadId));
        if (!binding) return;
        yield* recoverSessionForThread({
          binding,
          operation: "ProviderService.proactiveGatewayCredentialRotation",
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider.session.proactive_gateway_rotation_failed", {
            threadId: event.threadId,
            provider: event.provider,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            retiredGatewaySessionRecoveries.delete(event.threadId);
          }),
        ),
        Effect.forkIn(runtimeEventProducerScope),
        Effect.asVoid,
      );
    });
  };
}
