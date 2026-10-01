import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory";
import { randomUUID } from "node:crypto";

import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Duration, Effect, Option, Layer, Ref } from "effect";
import { ProviderLifecycle, type ProviderLifecycleShape } from "../Services/ProviderLifecycle";
import * as Semaphore from "effect/Semaphore";

const URGENT_LOCK_WAIT = Duration.seconds(5);
const URGENT_LOCK_POLL = Duration.millis(25);

export const ProviderLifecycleLive = Layer.effect(
  ProviderLifecycle,
  Effect.gen(function* () {
    const state = yield* Ref.make({
      locks: new Map<ThreadId, { readonly semaphore: Semaphore.Semaphore; users: number }>(),
      currentGenerations: new Map<ThreadId, string>(),
    });
    const { locks, currentGenerations } = Ref.getUnsafe(state);

    const directory = yield* ProviderSessionDirectory;
    for (const binding of yield* directory.listBindings()) {
      if (binding.lifecycleGeneration !== undefined)
        currentGenerations.set(binding.threadId, binding.lifecycleGeneration);
    }

    type LockEntry = { readonly semaphore: Semaphore.Semaphore; users: number };

    const referenceEntry = (threadId: ThreadId): LockEntry => {
      let entry = locks.get(threadId);
      if (entry === undefined) {
        entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
        locks.set(threadId, entry);
      }
      entry.users += 1;
      return entry;
    };

    const releaseEntry = (threadId: ThreadId, entry: LockEntry) =>
      Effect.sync(() => {
        entry.users -= 1;
        if (entry.users === 0 && locks.get(threadId) === entry) {
          locks.delete(threadId);
        }
      });

    const withThreadLock = <A, E, R>(
      threadId: ThreadId,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        const entry = referenceEntry(threadId);
        return entry.semaphore
          .withPermits(1)(effect)
          .pipe(Effect.ensuring(releaseEntry(threadId, entry)));
      });

    const withThreadLockOrBypass = <A, E, R>(
      threadId: ThreadId,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        const entry = referenceEntry(threadId);
        const deadlineMs = Date.now() + Duration.toMillis(URGENT_LOCK_WAIT);
        // Polling `withPermitsIfAvailable` instead of racing a timeout against a pending acquisition: a
        // timed-out `take` can strand a permit and wedge the thread's lifecycle for the life of the
        // process.
        const attempt: Effect.Effect<A, E, R> = Effect.suspend(() =>
          entry.semaphore
            .withPermitsIfAvailable(1)(effect)
            .pipe(
              Effect.flatMap((result) => {
                if (Option.isSome(result)) return Effect.succeed(result.value);
                if (Date.now() < deadlineMs) {
                  return Effect.sleep(URGENT_LOCK_POLL).pipe(Effect.andThen(attempt));
                }
                return Effect.logWarning(
                  "provider lifecycle lock bypassed for an urgent control-plane operation",
                  { threadId, waitedMs: Duration.toMillis(URGENT_LOCK_WAIT) },
                ).pipe(Effect.andThen(effect));
              }),
            ),
        );
        return attempt.pipe(Effect.ensuring(releaseEntry(threadId, entry)));
      });

    const run: ProviderLifecycleShape["run"] = (threadId, operation, prepare) =>
      withThreadLock(
        threadId,

        Effect.andThen(
          prepare ?? Effect.void,
          Effect.suspend(() => {
            const generation = randomUUID();
            const previousGeneration = currentGenerations.get(threadId);
            currentGenerations.set(threadId, generation);
            let ownedGeneration: string = generation;
            // The eagerly published generation is rewound on exit unless the run explicitly
            // committed/adopted/retired, so a run that ends without changing anything — a successful no-op
            // early return, a failure, an interrupt before the provider was touched — leaves the still-live
            // session's generation exactly as it found it.
            let owned = false;
            const isCurrent = () => currentGenerations.get(threadId) === ownedGeneration;
            return operation({
              generation,
              isCurrent,
              commit: () => {
                if (isCurrent()) owned = true;
              },
              adopt: (adoptedGeneration) => {
                if (isCurrent()) {
                  ownedGeneration = adoptedGeneration;
                  currentGenerations.set(threadId, adoptedGeneration);
                  owned = true;
                }
              },
              retire: () => {
                if (isCurrent()) {
                  currentGenerations.delete(threadId);
                  owned = true;
                }
              },
            }).pipe(
              Effect.onExit(() =>
                owned || !isCurrent()
                  ? Effect.void
                  : Effect.sync(() => {
                      if (previousGeneration === undefined) {
                        currentGenerations.delete(threadId);
                      } else {
                        currentGenerations.set(threadId, previousGeneration);
                      }
                    }),
              ),
            );
          }),
        ),
      );

    return {
      run,
      runCurrent: (threadId, operation) =>
        withThreadLock(
          threadId,
          Effect.suspend(() => operation(currentGenerations.get(threadId))),
        ),
      runCurrentUrgent: (threadId, operation) =>
        withThreadLockOrBypass(
          threadId,
          Effect.suspend(() => operation(currentGenerations.get(threadId))),
        ),
      currentGeneration: (threadId) => currentGenerations.get(threadId),
    };
  }),
);
