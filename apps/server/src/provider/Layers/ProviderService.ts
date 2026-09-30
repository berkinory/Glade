import { Effect, Deferred, Cause, Layer } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import { randomUUID } from "node:crypto";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryWriteError,
} from "../Services/ProviderSessionDirectory";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService";
import type { ProviderAdapterError } from "../core/Errors";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents";
import { settleConcurrentTeardowns } from "../core/settleConcurrentTeardowns";
import { summarizeProviderRuntimeQuarantineCause } from "../core/providerServiceValidation";
import {
  type ProviderServiceLiveOptions,
  PROVIDER_RUNTIME_IDLE_STOP_MS,
} from "../core/providerServiceConfiguration";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";
import { ProviderIdleRuntimeLive } from "./ProviderIdleRuntime";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";
import { ProviderRuntimeBindingsLive } from "./ProviderRuntimeBindings";
import { ProviderRuntimeEvents } from "../Services/ProviderRuntimeEvents";
import { ProviderRuntimeEventsLive } from "./ProviderRuntimeEvents";
import { ProviderSessionStartup } from "../Services/ProviderSessionStartup";
import { ProviderSessionStartupLive } from "./ProviderSessionStartup";
import { ProviderSessionBranching } from "../Services/ProviderSessionBranching";
import { ProviderSessionBranchingLive } from "./ProviderSessionBranching";
import { ProviderTurnDispatch } from "../Services/ProviderTurnDispatch";
import { ProviderTurnDispatchLive } from "./ProviderTurnDispatch";
import { ProviderSessionTeardown } from "../Services/ProviderSessionTeardown";
import { ProviderSessionTeardownLive } from "./ProviderSessionTeardown";
import { ProviderTaskControl } from "../Services/ProviderTaskControl";
import { ProviderTaskControlLive } from "./ProviderTaskControl";
import { ProviderSessionReads } from "../Services/ProviderSessionReads";
import { ProviderSessionReadsLive } from "./ProviderSessionReads";
import { ProviderInterruptionsLive } from "./ProviderInterruptions";
import { ProviderLifecycleLive } from "./ProviderLifecycle";
import { ProviderAdmission } from "../Services/ProviderAdmission";
import { ensureProviderEnabled } from "../core/providerServiceConfiguration";
import { ProviderSessionRoutingLive } from "./ProviderSessionRouting";
const makeProviderService = Effect.gen(function* () {
  const registry = yield* ProviderAdapterRegistry;
  const directory = yield* ProviderSessionDirectory;
  const bindings = yield* ProviderRuntimeBindings;
  const idle = yield* ProviderIdleRuntime;
  const events = yield* ProviderRuntimeEvents;
  const startup = yield* ProviderSessionStartup;
  const branching = yield* ProviderSessionBranching;
  const turns = yield* ProviderTurnDispatch;
  const teardown = yield* ProviderSessionTeardown;
  const tasks = yield* ProviderTaskControl;
  const reads = yield* ProviderSessionReads;
  const adapters = yield* Effect.forEach(yield* registry.listProviders(), (provider) =>
    registry.getByProvider(provider),
  );
  yield* events.startPumps;
  yield* idle.installStopHandler(teardown.stopRuntimeSessionInternal);
  const stopAll = Effect.gen(function* () {
    const stoppedAt = new Date().toISOString();
    const runtimeCursorWriteBaseline = yield* bindings.beginShutdown(stoppedAt);
    const activeSessionByThreadId = new Map(
      (yield* Effect.forEach(adapters, (adapter) =>
        adapter
          .listSessions()
          .pipe(Effect.map((sessions) => sessions.map((session) => ({ adapter, session })))),
      ))
        .flatMap((sessions) => sessions)
        .map(({ adapter, session }) => [session.threadId, { adapter, session }] as const),
    );
    const activeSessionWrites = yield* Effect.forEach(
      activeSessionByThreadId.values(),
      ({ adapter, session }) =>
        Deferred.make<void>().pipe(Effect.map((started) => ({ adapter, session, started }))),
    );
    const persistActiveSessions = settleConcurrentTeardowns(
      activeSessionWrites,
      ({ adapter, session, started }) =>
        bindings.withQueuedBindingWrite(
          session.threadId,
          Effect.gen(function* () {
            const latestSession = (yield* adapter.listSessions()).find(
              (candidate) => candidate.threadId === session.threadId,
            );
            const queuedResumeCursor = bindings.cursorWrittenSince(
              session.threadId,
              runtimeCursorWriteBaseline,
            );
            const stoppedSession = latestSession ?? session;
            const resumeCursor =
              latestSession?.resumeCursor ?? queuedResumeCursor ?? session.resumeCursor;
            yield* bindings.markThreadStopped(
              session.threadId,
              stoppedAt,
              resumeCursor !== undefined && resumeCursor !== stoppedSession.resumeCursor
                ? { ...stoppedSession, resumeCursor }
                : stoppedSession,
            );
          }),
          started,
        ),
    );
    const persistInactiveSessions = Effect.gen(function* () {
      const threadIds = yield* directory.listThreadIds();
      yield* Effect.forEach(
        threadIds.filter((threadId) => !activeSessionByThreadId.has(threadId)),
        (threadId) =>
          bindings.withBindingWriteLock(threadId, bindings.markThreadStopped(threadId, stoppedAt)),
      );
    });
    const stopAdapters = Effect.forEach(
      activeSessionWrites,
      ({ started }) => Deferred.await(started),
      { concurrency: "unbounded", discard: true },
    ).pipe(Effect.andThen(settleConcurrentTeardowns(adapters, (adapter) => adapter.stopAll())));

    const shutdownWork: ReadonlyArray<
      Effect.Effect<void, ProviderAdapterError | ProviderSessionDirectoryWriteError, never>
    > = [persistActiveSessions, persistInactiveSessions, stopAdapters];
    yield* settleConcurrentTeardowns(shutdownWork, (teardown) => teardown);
  });

  const closeRuntimeEvents = yield* Effect.cached(
    Effect.uninterruptible(
      idle.shutdown.pipe(
        Effect.andThen(
          stopAll.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to stop provider sessions", {
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
        // Keep subscriptions alive until adapters have emitted terminal events. Closing waits for an
        // in-flight canonical event because its persistence and publication section is uninterruptible.
        Effect.andThen(events.shutdown),
      ),
    ),
  );

  yield* Effect.addFinalizer(() => closeRuntimeEvents);

  const persistedEvents = events.streamPersistedEvents;
  return {
    ...startup,
    ...branching,
    ...turns,
    stopSession: teardown.stopSession,
    stopRuntimeSession: teardown.stopRuntimeSession,
    hasLiveRuntimeTasks: teardown.hasLiveRuntimeTasks,
    clearSessionResumeCursor: teardown.clearSessionResumeCursor,
    ...tasks,
    ...reads,
    closeRuntimeEvents,
    getRuntimeEventPumpHealth: events.getRuntimeEventPumpHealth,
    get streamEvents(): ProviderServiceShape["streamEvents"] {
      return events.streamEvents;
    },
    ...(persistedEvents === undefined
      ? {}
      : {
          get streamPersistedEvents(): NonNullable<ProviderServiceShape["streamPersistedEvents"]> {
            return persistedEvents;
          },
        }),
  } satisfies ProviderServiceShape;
});

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  const base = Layer.mergeAll(
    ProviderInterruptionsLive,
    ProviderLifecycleLive,
    Layer.succeed(ProviderAdmission, {
      ensureProviderEnabled: (provider, operation) =>
        ensureProviderEnabled(options?.providerIsEnabled, provider, operation),
    }),
  );
  const idle = ProviderIdleRuntimeLive(
    Math.max(0, options?.runtimeIdleStopMs ?? PROVIDER_RUNTIME_IDLE_STOP_MS),
  ).pipe(Layer.provideMerge(base));
  const bindings = ProviderRuntimeBindingsLive.pipe(Layer.provideMerge(idle));
  const routing = ProviderSessionRoutingLive.pipe(Layer.provideMerge(bindings));
  const operations = Layer.mergeAll(
    ProviderSessionStartupLive,
    ProviderSessionBranchingLive,
    ProviderTurnDispatchLive,
    ProviderSessionTeardownLive,
    ProviderSessionReadsLive,
    ProviderRuntimeEventsLive(options),
  ).pipe(Layer.provideMerge(routing));
  // Isolate private owners per instance while sharing this public Layer within its graph.
  return Layer.effect(ProviderService, makeProviderService).pipe(
    Layer.provide(Layer.fresh(ProviderTaskControlLive.pipe(Layer.provideMerge(operations)))),
  );
}

export function makeDurableProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const runtimeEvents = yield* ProviderRuntimeEventRepository;
      return makeProviderServiceLive({
        ...options,
        persistRuntimeEvent: (event) => runtimeEvents.append(event),
        quarantineRuntimeEvent: (event, cause) =>
          runtimeEvents
            .append({
              type: "runtime.warning",
              eventId: EventId.makeUnsafe(randomUUID()),
              provider: event.provider,
              threadId: event.threadId,
              createdAt: new Date().toISOString(),
              ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
              ...(event.lifecycleGeneration !== undefined
                ? { lifecycleGeneration: event.lifecycleGeneration }
                : {}),
              payload: {
                message: `Quarantined provider runtime event '${event.type}' after a permanent journal failure.`,
                detail: {
                  originalEventId: event.eventId,
                  originalEventType: event.type,
                  ...summarizeProviderRuntimeQuarantineCause(cause),
                },
              },
            })
            .pipe(Effect.asVoid),
      });
    }),
  );
}
