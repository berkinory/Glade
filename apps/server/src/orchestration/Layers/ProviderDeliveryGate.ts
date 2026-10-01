import { Effect, Layer, Ref, Semaphore } from "effect";
import type { ProviderCommandReactorShape } from "../Services/ProviderCommandReactor.ts";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";

export const ProviderDeliveryGateLive = Layer.effect(
  ProviderDeliveryGate,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const quarantinedThreads = new Set<string>();
      const acceptedCompletionContexts = new Set<number>();
      const reconciler = yield* Ref.make<
        ProviderCommandReactorShape["reconcileDelivery"] | undefined
      >(undefined);
      const sourceLock = yield* Semaphore.make(1);
      return {
        gate: {
          isQuarantined: (threadId: string) => quarantinedThreads.has(threadId),
          quarantine: (threadId: string) => {
            quarantinedThreads.add(threadId);
          },
          releaseQuarantine: (threadId: string) => {
            quarantinedThreads.delete(threadId);
          },
          markCompletionContext: (sequence: number) => {
            acceptedCompletionContexts.add(sequence);
          },
          hasCompletionContext: (sequence: number) => acceptedCompletionContexts.has(sequence),
          clearCompletionContext: (sequence: number) => {
            acceptedCompletionContexts.delete(sequence);
          },
          getReconciler: () => Ref.getUnsafe(reconciler),
          setReconciler: (runtime: ProviderCommandReactorShape["reconcileDelivery"]) =>
            Ref.set(reconciler, runtime),
          withSourceLock: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            sourceLock.withPermits(1)(effect),
        },
        dispose: () => {
          quarantinedThreads.clear();
          acceptedCompletionContexts.clear();
        },
      };
    }),
    (owner) => Effect.sync(owner.dispose),
  ).pipe(Effect.map((owner) => owner.gate)),
);
