import type { ServiceMap } from "effect";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { Ref } from "effect";
import { Effect, Option, Cause } from "effect";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { hasResumeCursor } from "../core/providerRuntimeBinding";
import { makeProviderIdleLifecycle } from "./idleLifecycle";
import { makeProviderSessionTeardown } from "./sessionTeardown";

export function makeProviderIdleStopCallback(input: {
  readonly isRuntimeIdleGenerationCurrent: ReturnType<
    typeof makeProviderIdleLifecycle
  >["isRuntimeIdleGenerationCurrent"];
  readonly directory: ServiceMap.Service.Shape<typeof ProviderSessionDirectory>;
  readonly retireRuntimeIdleGeneration: ReturnType<
    typeof makeProviderIdleLifecycle
  >["retireRuntimeIdleGeneration"];
  readonly liveRuntimeTaskIds: Map<ThreadId, Set<string>>;
  readonly stopRuntimeSessionInternal: ReturnType<
    typeof makeProviderSessionTeardown
  >["stopRuntimeSessionInternal"];
  readonly registry: ServiceMap.Service.Shape<typeof ProviderAdapterRegistry>;
  readonly runtimeIdleCleanupGenerations: Map<ThreadId, symbol>;
  readonly runtimeIdleTimers: Map<ThreadId, ReturnType<typeof setTimeout>>;
  readonly stopIdleRuntimeSession: Ref.Ref<
    ((threadId: ThreadId, generation: symbol, cleanupStarted?: boolean) => void) | null
  >;
  readonly runtimeIdleStopMs: number;
  readonly callbackServices: ServiceMap.ServiceMap<never>;
  readonly runtimeIdleStopsInFlight: Map<ThreadId, Promise<void>>;
}): (threadId: ThreadId, generation: symbol, cleanupStarted?: boolean) => void {
  const {
    isRuntimeIdleGenerationCurrent,
    directory,
    retireRuntimeIdleGeneration,
    liveRuntimeTaskIds,
    stopRuntimeSessionInternal,
    registry,
    runtimeIdleCleanupGenerations,
    runtimeIdleTimers,
    stopIdleRuntimeSession,
    runtimeIdleStopMs,
    callbackServices,
    runtimeIdleStopsInFlight,
  } = input;
  return (threadId, generation, cleanupStarted = false) => {
    const stopEffect = Effect.gen(function* () {
      if (!isRuntimeIdleGenerationCurrent(threadId, generation)) {
        return;
      }
      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      if (!binding) {
        retireRuntimeIdleGeneration(threadId, generation);
        return;
      }

      const bindingRuntimePayload = asRecord(binding.runtimePayload) ?? {};
      if (
        (bindingRuntimePayload.activeTurnId !== null &&
          bindingRuntimePayload.activeTurnId !== undefined) ||
        (liveRuntimeTaskIds.get(threadId)?.size ?? 0) > 0
      ) {
        retireRuntimeIdleGeneration(threadId, generation);
        return;
      }

      if (cleanupStarted) {
        yield* stopRuntimeSessionInternal({ threadId }, generation);
        return;
      }
      const adapter = yield* registry.getByProvider(binding.provider);
      const sessions = yield* adapter.listSessions();
      const session = sessions.find((entry) => entry.threadId === threadId);
      const isIdleReadySession =
        session?.status === "ready" ||
        (session?.status === "running" &&
          binding.status === "stopped" &&
          (bindingRuntimePayload.lastRuntimeEvent === "thread.state.changed" ||
            bindingRuntimePayload.lastRuntimeEvent === "provider.compactThread"));
      if (
        !session ||
        !isIdleReadySession ||
        session.activeTurnId !== undefined ||
        (liveRuntimeTaskIds.get(threadId)?.size ?? 0) > 0
      ) {
        retireRuntimeIdleGeneration(threadId, generation);
        return;
      }

      if (!hasResumeCursor(session.resumeCursor) && !hasResumeCursor(binding.resumeCursor)) {
        retireRuntimeIdleGeneration(threadId, generation);
        return;
      }
      if (!isRuntimeIdleGenerationCurrent(threadId, generation)) {
        return;
      }

      cleanupStarted = true;
      runtimeIdleCleanupGenerations.set(threadId, generation);
      yield* stopRuntimeSessionInternal({ threadId }, generation);
    }).pipe(
      Effect.catchCause((cause) => {
        if (
          !Cause.hasInterruptsOnly(cause) &&
          isRuntimeIdleGenerationCurrent(threadId, generation)
        ) {
          const timer = setTimeout(
            () => {
              runtimeIdleTimers.delete(threadId);
              Ref.getUnsafe(stopIdleRuntimeSession)?.(threadId, generation, cleanupStarted);
            },
            Math.max(1_000, Math.min(runtimeIdleStopMs, 30_000)),
          );
          timer.unref();
          runtimeIdleTimers.set(threadId, timer);
        }
        return Effect.logWarning("provider.session.idle_stop_failed", {
          threadId,
          cause,
        });
      }),
    );
    const stopPromise = Effect.runPromiseWith(callbackServices)(stopEffect).finally(() => {
      if (runtimeIdleStopsInFlight.get(threadId) === stopPromise) {
        runtimeIdleStopsInFlight.delete(threadId);
      }
    });
    runtimeIdleStopsInFlight.set(threadId, stopPromise);
  };
}
