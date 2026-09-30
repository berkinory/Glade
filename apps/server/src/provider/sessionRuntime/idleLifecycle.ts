import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Ref } from "effect";
import { Effect, Exit } from "effect";
import { ProviderValidationError } from "../core/Errors.ts";
import { toValidationError } from "../core/providerServiceValidation";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { makeProviderInterruptionFence } from "./interruptionFence";

export function makeProviderIdleLifecycle(input: {
  readonly runtimeIdleCleanupGenerations: Map<ThreadId, symbol>;
  readonly runtimeIdleGenerations: Map<ThreadId, symbol>;
  readonly runtimeIdleTimers: Map<ThreadId, ReturnType<typeof setTimeout>>;
  readonly liveRuntimeTaskIds: Map<ThreadId, Set<string>>;
  readonly runtimeIdleStopMs: number;
  readonly stopIdleRuntimeSession: Ref.Ref<
    ((threadId: ThreadId, generation: symbol, cleanupStarted?: boolean) => void) | null
  >;
  readonly runtimeTaskSettlementWaiters: Map<ThreadId, Set<() => void>>;
  readonly runtimeIdleStopsInFlight: Map<ThreadId, Promise<void>>;
  readonly waitForCurrentInterruptionFence: ReturnType<
    typeof makeProviderInterruptionFence
  >["waitForCurrentInterruptionFence"];
}) {
  const {
    runtimeIdleCleanupGenerations,
    runtimeIdleGenerations,
    runtimeIdleTimers,
    liveRuntimeTaskIds,
    runtimeIdleStopMs,
    stopIdleRuntimeSession,
    runtimeTaskSettlementWaiters,
    runtimeIdleStopsInFlight,
    waitForCurrentInterruptionFence,
  } = input;
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
      Ref.getUnsafe(stopIdleRuntimeSession)?.(threadId, generation);
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
      const waitForInterruptionFence = waitForCurrentInterruptionFence(threadId).pipe(
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
      const displacedIdleStop = existingIdleStop !== undefined || runtimeIdleTimers.has(threadId);
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
  return {
    clearRuntimeIdleTimer,
    runIdleSensitiveProviderWork,
    reconcileRuntimeIdleTimer,
    waitForLiveRuntimeTasksToSettle,
    waitForRuntimeIdleStop,
    clearLiveRuntimeTasks,
    retireRuntimeIdleGeneration,
    isRuntimeIdleGenerationCurrent,
  };
}
