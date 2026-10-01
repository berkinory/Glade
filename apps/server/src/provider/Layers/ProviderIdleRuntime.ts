import { ProviderInterruptions } from "../Services/ProviderInterruptions";
import { ProviderIdleRuntime, type StopIdleRuntime } from "../Services/ProviderIdleRuntime";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { hasResumeCursor } from "../core/providerRuntimeBinding";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Ref } from "effect";
import { Effect, Exit, Layer, Option, Cause } from "effect";
import { ProviderValidationError } from "../core/Errors.ts";
import { toValidationError } from "../core/providerServiceValidation";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

export function ProviderIdleRuntimeLive(runtimeIdleStopMs: number) {
  return Layer.effect(
    ProviderIdleRuntime,
    Effect.gen(function* () {
      const interruptions = yield* ProviderInterruptions;
      const directory = yield* ProviderSessionDirectory;
      const registry = yield* ProviderAdapterRegistry;
      // Timers use the captured Layer runtime, including tracing and interruption context.
      const callbackServices = yield* Effect.services<never>();
      const state = yield* Ref.make({
        runtimeIdleCleanupGenerations: new Map<ThreadId, symbol>(),
        runtimeIdleGenerations: new Map<ThreadId, symbol>(),
        runtimeIdleTimers: new Map<ThreadId, ReturnType<typeof setTimeout>>(),
        liveRuntimeTaskIds: new Map<ThreadId, Set<string>>(),
        runtimeTaskSettlementWaiters: new Map<ThreadId, Set<() => void>>(),
        runtimeIdleStopsInFlight: new Map<ThreadId, Promise<void>>(),
      });
      const {
        runtimeIdleCleanupGenerations,
        runtimeIdleGenerations,
        runtimeIdleTimers,
        liveRuntimeTaskIds,
        runtimeTaskSettlementWaiters,
        runtimeIdleStopsInFlight,
      } = Ref.getUnsafe(state);
      const stopRuntime = yield* Ref.make<StopIdleRuntime | null>(null);
      const invalidateRuntimeIdleGeneration = (threadId: ThreadId): symbol => {
        const generation = Symbol(String(threadId));
        runtimeIdleCleanupGenerations.delete(threadId);
        runtimeIdleGenerations.set(threadId, generation);
        return generation;
      };

      const isRuntimeIdleGenerationCurrent = (threadId: ThreadId, generation: symbol): boolean =>
        runtimeIdleGenerations.get(threadId) === generation;

      const retireRuntimeIdleGeneration = (threadId: ThreadId, generation?: symbol): void => {
        if (generation === undefined || isRuntimeIdleGenerationCurrent(threadId, generation)) {
          runtimeIdleGenerations.delete(threadId);
          runtimeIdleCleanupGenerations.delete(threadId);
        }
      };

      const clearRuntimeIdleTimer = (threadId: ThreadId) => {
        invalidateRuntimeIdleGeneration(threadId);
        const timer = runtimeIdleTimers.get(threadId);
        if (!timer) {
          return;
        }
        clearTimeout(timer);
        runtimeIdleTimers.delete(threadId);
      };

      const scheduleRuntimeIdleStop = (threadId: ThreadId) => {
        clearRuntimeIdleTimer(threadId);
        // A parent turn can finish while provider-native tasks keep running in the same subprocess. Those
        // tasks own the runtime until the last one settles, even though the adapter session otherwise looks
        // idle-ready.
        if ((liveRuntimeTaskIds.get(threadId)?.size ?? 0) > 0) {
          return;
        }
        if (runtimeIdleStopMs <= 0) {
          retireRuntimeIdleGeneration(threadId);
          return;
        }

        const generation = invalidateRuntimeIdleGeneration(threadId);
        const timer = setTimeout(() => {
          runtimeIdleTimers.delete(threadId);
          if (Ref.getUnsafe(stopRuntime)) stopIdleRuntimeSession(threadId, generation);
        }, runtimeIdleStopMs);
        timer.unref();
        runtimeIdleTimers.set(threadId, timer);
      };

      const markRuntimeTaskLive = (threadId: ThreadId, taskId: string): void => {
        const taskIds = liveRuntimeTaskIds.get(threadId) ?? new Set<string>();
        taskIds.add(taskId);
        liveRuntimeTaskIds.set(threadId, taskIds);
        clearRuntimeIdleTimer(threadId);
      };

      const resolveRuntimeTaskSettlementWaiters = (threadId: ThreadId): void => {
        const waiters = runtimeTaskSettlementWaiters.get(threadId);
        runtimeTaskSettlementWaiters.delete(threadId);
        for (const resolve of waiters ?? []) resolve();
      };

      const clearLiveRuntimeTasks = (threadId: ThreadId): void => {
        liveRuntimeTaskIds.delete(threadId);
        resolveRuntimeTaskSettlementWaiters(threadId);
      };

      const waitForLiveRuntimeTasksToSettle = (threadId: ThreadId): Effect.Effect<void> =>
        Effect.suspend(() => {
          if ((liveRuntimeTaskIds.get(threadId)?.size ?? 0) === 0) return Effect.void;
          let resolveWaiter!: () => void;
          const settled = new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
          const waiters = runtimeTaskSettlementWaiters.get(threadId) ?? new Set<() => void>();
          waiters.add(resolveWaiter);
          runtimeTaskSettlementWaiters.set(threadId, waiters);
          return Effect.promise(() => settled).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const current = runtimeTaskSettlementWaiters.get(threadId);
                current?.delete(resolveWaiter);
                if (current?.size === 0) runtimeTaskSettlementWaiters.delete(threadId);
              }),
            ),

            Effect.andThen(waitForLiveRuntimeTasksToSettle(threadId)),
          );
        });

      const markRuntimeTaskSettled = (threadId: ThreadId, taskId: string): void => {
        const taskIds = liveRuntimeTaskIds.get(threadId);
        taskIds?.delete(taskId);
        if (taskIds && taskIds.size > 0) {
          return;
        }
        clearLiveRuntimeTasks(threadId);
        scheduleRuntimeIdleStop(threadId);
      };

      const waitForRuntimeIdleStop = (threadId: ThreadId): Effect.Effect<void> =>
        Effect.promise(() => runtimeIdleStopsInFlight.get(threadId) ?? Promise.resolve());

      const runIdleSensitiveProviderWork = <A, E, R>(
        threadId: ThreadId,
        effect: Effect.Effect<A, E, R>,
        options?: { readonly scheduleIdleStopOnSuccess?: boolean },
      ): Effect.Effect<A, E | ProviderValidationError, R> =>
        Effect.suspend(() => {
          const waitForInterruptionFence = interruptions
            .wait(threadId)
            .pipe(
              Effect.flatMap((interruptionFence) =>
                interruptionFence?.failure
                  ? Effect.fail(
                      toValidationError(
                        "ProviderService.turnDispatch",
                        `Cannot start a new provider turn because the interrupted runtime could not be retired safely: ${interruptionFence.failure}`,
                      ),
                    )
                  : Effect.void,
              ),
            );
          const existingIdleStop = runtimeIdleStopsInFlight.get(threadId);
          const displacedIdleStop =
            existingIdleStop !== undefined || runtimeIdleTimers.has(threadId);
          const waitForExistingIdleStop =
            existingIdleStop !== undefined ? Effect.promise(() => existingIdleStop) : Effect.void;
          return waitForInterruptionFence.pipe(
            Effect.andThen(waitForExistingIdleStop),
            Effect.tap(() => Effect.sync(() => clearRuntimeIdleTimer(threadId))),
            Effect.flatMap(() => waitForRuntimeIdleStop(threadId)),
            Effect.flatMap(() => effect),
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? options?.scheduleIdleStopOnSuccess === true
                  ? Effect.sync(() => scheduleRuntimeIdleStop(threadId))
                  : Effect.void
                : displacedIdleStop
                  ? Effect.sync(() => scheduleRuntimeIdleStop(threadId))
                  : Effect.sync(() => retireRuntimeIdleGeneration(threadId)),
            ),
          );
        });

      const reconcileRuntimeIdleTimer = (event: ProviderRuntimeEvent) => {
        switch (event.type) {
          case "turn.started":
            clearRuntimeIdleTimer(event.threadId);
            return;
          case "task.started":
          case "task.progress":
            markRuntimeTaskLive(event.threadId, event.payload.taskId);
            return;
          case "task.updated":
            if (
              event.payload.status === "completed" ||
              event.payload.status === "failed" ||
              event.payload.status === "killed" ||
              event.payload.status === "paused"
            ) {
              markRuntimeTaskSettled(event.threadId, event.payload.taskId);
            } else {
              markRuntimeTaskLive(event.threadId, event.payload.taskId);
            }
            return;
          case "task.completed":
            markRuntimeTaskSettled(event.threadId, event.payload.taskId);
            return;
          case "session.started":
          case "thread.started":
          case "turn.completed":
          case "turn.aborted":
            scheduleRuntimeIdleStop(event.threadId);
            return;
          case "thread.state.changed":
            if (
              event.payload.state === "compacted" ||
              event.payload.state === "archived" ||
              event.payload.state === "closed"
            ) {
              if (event.payload.state === "archived" || event.payload.state === "closed") {
                clearLiveRuntimeTasks(event.threadId);
              }
              scheduleRuntimeIdleStop(event.threadId);
            }
            return;
          case "session.exited":
            clearLiveRuntimeTasks(event.threadId);

            if (runtimeIdleCleanupGenerations.has(event.threadId)) {
              return;
            }
            clearRuntimeIdleTimer(event.threadId);
            retireRuntimeIdleGeneration(event.threadId);
            return;
        }
      };
      const stopIdleRuntimeSession = (
        threadId: ThreadId,
        generation: symbol,
        cleanupStarted = false,
      ): void => {
        const stopEffect = Effect.gen(function* () {
          const stopRuntimeSessionInternal = Ref.getUnsafe(stopRuntime);
          if (!stopRuntimeSessionInternal) return;
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
                  if (Ref.getUnsafe(stopRuntime))
                    stopIdleRuntimeSession(threadId, generation, cleanupStarted);
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
      return {
        clearRuntimeIdleTimer,
        runIdleSensitiveProviderWork,
        reconcileRuntimeIdleTimer,
        waitForLiveRuntimeTasksToSettle,
        waitForRuntimeIdleStop,
        clearLiveRuntimeTasks,
        retireRuntimeIdleGeneration,
        isRuntimeIdleGenerationCurrent,
        hasLiveTasks: (threadId: ThreadId) => (liveRuntimeTaskIds.get(threadId)?.size ?? 0) > 0,
        installStopHandler: (handler: StopIdleRuntime) => Ref.set(stopRuntime, handler),
        shutdown: Effect.sync(() => {
          for (const timer of runtimeIdleTimers.values()) clearTimeout(timer);
          runtimeIdleTimers.clear();
          for (const threadId of new Set([
            ...liveRuntimeTaskIds.keys(),
            ...runtimeTaskSettlementWaiters.keys(),
          ]))
            clearLiveRuntimeTasks(threadId);
          runtimeIdleGenerations.clear();
          runtimeIdleCleanupGenerations.clear();
          runtimeIdleStopsInFlight.clear();
        }).pipe(Effect.andThen(Ref.set(stopRuntime, null))),
      };
    }),
  );
}
