import {
  ProviderServiceLiveOptions,
  PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY,
  PROVIDER_RUNTIME_IDLE_STOP_MS,
} from "../core/providerServiceConfiguration";
import {
  Effect,
  PubSub,
  Scope,
  Option,
  Cause,
  Schema,
  Deferred,
  Exit,
  Stream,
  Layer,
} from "effect";
import { makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryWriteError,
} from "../Services/ProviderSessionDirectory.ts";
import { type ProviderKind, ThreadId, EventId } from "@glade/contracts/core/baseSchemas";
import { ProviderValidationError, type ProviderAdapterError } from "../core/Errors.ts";
import { makeProviderLifecycleCoordinator } from "../core/providerLifecycleCoordinator.ts";
import type { PublishedRuntimeEvent, ThreadDispatchState } from "../core/providerRuntimeBinding.ts";
import {
  ProviderInterruptionFence,
  TargetedChildInterruptTombstone,
} from "../core/providerRuntimeBinding";
import { Ref } from "effect";
import { makeKeyedLock } from "../core/keyedLock.ts";
import {
  makeProviderRuntimeEventPumpHealthRegistry,
  runProviderRuntimeEventPump,
} from "../core/providerRuntimeEventPump.ts";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { PersistenceDecodeError } from "../../persistence/Errors.ts";
import { settleConcurrentTeardowns } from "../core/settleConcurrentTeardowns.ts";
import { type ProviderServiceShape, ProviderService } from "../Services/ProviderService.ts";
import {
  type PersistedProviderRuntimeEvent,
  ProviderRuntimeEventRepository,
} from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { randomUUID } from "node:crypto";
import { summarizeProviderRuntimeQuarantineCause } from "../core/providerServiceValidation";
import { makeProviderInterruptionFence } from "../sessionRuntime/interruptionFence";
import { makeProviderIdleLifecycle } from "../sessionRuntime/idleLifecycle";
import { makeProviderRuntimeBinding } from "../sessionRuntime/runtimeBinding";
import { makeProviderRuntimeEvents } from "../sessionRuntime/runtimeEvents";
import { makeProviderSessionRecovery } from "../sessionRuntime/sessionRecovery";
import { makeProviderSessionStartup } from "../sessionRuntime/sessionStartup";
import { makeProviderSessionBranching } from "../sessionRuntime/sessionBranching";
import { makeProviderTurnDispatch } from "../sessionRuntime/turnDispatch";
import { makeProviderSessionTeardown } from "../sessionRuntime/sessionTeardown";
import { makeProviderTaskControl } from "../sessionRuntime/taskControl";
import { makeProviderSessionReads } from "../sessionRuntime/sessionReads";
import { makeProviderScheduledRecoveryCallback } from "../sessionRuntime/scheduledRecoveryCallback";
import { makeProviderIdleStopCallback } from "../sessionRuntime/idleStopCallback";

const makeProviderService = (options?: ProviderServiceLiveOptions) =>
  Effect.gen(function* () {
    const canonicalEventLogger =
      options?.canonicalEventLogger ??
      (options?.canonicalEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
            stream: "canonical",
          })
        : undefined);

    const registry = yield* ProviderAdapterRegistry;
    const directory = yield* ProviderSessionDirectory;
    // Timer callbacks use the Layer runtime so tracing and service context survive the Promise boundary.
    const callbackServices = yield* Effect.services<never>();

    const ensureProviderEnabled = (provider: ProviderKind, operation: string) =>
      options?.providerIsEnabled
        ? options.providerIsEnabled(provider).pipe(
            Effect.flatMap((enabled) =>
              enabled
                ? Effect.void
                : Effect.fail(
                    new ProviderValidationError({
                      operation,
                      issue: `${provider} is disabled in Settings > Providers.`,
                    }),
                  ),
            ),
          )
        : Effect.void;
    const lifecycle = makeProviderLifecycleCoordinator();
    for (const binding of yield* directory.listBindings()) {
      if (binding.lifecycleGeneration !== undefined) {
        lifecycle.adoptCurrent(binding.threadId, binding.lifecycleGeneration);
      }
    }
    const runtimeEventBufferCapacity = Math.max(
      1,
      Math.floor(options?.runtimeEventBufferCapacity ?? PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY),
    );
    const runtimeEventPubSub = yield* PubSub.bounded<PublishedRuntimeEvent>(
      runtimeEventBufferCapacity,
    );
    const runtimeEventProducerScope = yield* Scope.make("sequential");
    const runtimeIdleTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
    const liveRuntimeTaskIds = new Map<ThreadId, Set<string>>();
    const runtimeTaskSettlementWaiters = new Map<ThreadId, Set<() => void>>();

    const runtimeIdleGenerations = new Map<ThreadId, symbol>();
    const runtimeIdleCleanupGenerations = new Map<ThreadId, symbol>();
    const runtimeIdleStopsInFlight = new Map<ThreadId, Promise<void>>();
    const providerInterruptionFences = new Map<ThreadId, ProviderInterruptionFence>();
    const targetedChildInterruptTombstones = new Map<string, TargetedChildInterruptTombstone>();
    const runtimeIdleStopMs = Math.max(
      0,
      options?.runtimeIdleStopMs ?? PROVIDER_RUNTIME_IDLE_STOP_MS,
    );
    const stopIdleRuntimeSession = yield* Ref.make<
      ((threadId: ThreadId, generation: symbol, cleanupStarted?: boolean) => void) | null
    >(null);

    const runtimeWriteState = yield* Ref.make<{
      readonly cursorWriteVersion: number;
      readonly shutdownStartedAt?: string;
    }>({ cursorWriteVersion: 0 });

    const latestRuntimeCursorWriteByThread = new Map<
      ThreadId,
      { readonly version: number; readonly resumeCursor: unknown }
    >();

    // Turn ids whose terminal runtime event has already been observed, keyed by thread. sendTurn
    // consults this immediately before its post-dispatch "running" upsert: a turn that settles before
    // that write lands (e.g. a pre-start cancellation) must not be re-marked as running afterwards. A
    // single slot per thread is not enough — sendTurn is not serialized per thread, so overlapping
    // sends can both settle pre-write and the second completion would evict the first turn's marker
    // before its send checked it.
    const recentlyCompletedTurnsByThread = new Map<ThreadId, Set<string>>();

    const bindingWriteLock = makeKeyedLock<ThreadId>();
    const dispatchStateByThread = new Map<ThreadId, ThreadDispatchState>();

    const providers = yield* registry.listProviders();
    const adapters = yield* Effect.forEach(providers, (provider) =>
      registry.getByProvider(provider),
    );
    const runtimeEventPumpHealth = makeProviderRuntimeEventPumpHealthRegistry(providers);
    const scheduleRetiredGatewaySessionRecovery = yield* Ref.make<
      (event: ProviderRuntimeEvent) => Effect.Effect<void>
    >((_event: ProviderRuntimeEvent): Effect.Effect<void> => Effect.void);

    const retiredGatewaySessionRecoveries = new Set<ThreadId>();

    const {
      waitForCurrentInterruptionFence,
      targetedChildInterruptKey,
      rememberTargetedChildInterrupt,
      acquireProviderInterruptionFence,
    } = makeProviderInterruptionFence({
      targetedChildInterruptTombstones,
      providerInterruptionFences,
    });
    const {
      clearRuntimeIdleTimer,
      runIdleSensitiveProviderWork,
      reconcileRuntimeIdleTimer,
      waitForLiveRuntimeTasksToSettle,
      waitForRuntimeIdleStop,
      clearLiveRuntimeTasks,
      retireRuntimeIdleGeneration,
      isRuntimeIdleGenerationCurrent,
    } = makeProviderIdleLifecycle({
      runtimeIdleCleanupGenerations,
      runtimeIdleGenerations,
      runtimeIdleTimers,
      liveRuntimeTaskIds,
      runtimeIdleStopMs,
      stopIdleRuntimeSession,
      runtimeTaskSettlementWaiters,
      runtimeIdleStopsInFlight,
      waitForCurrentInterruptionFence,
    });
    const {
      updateSessionBindingFromRuntimeEvent,
      withBindingWriteLock,
      upsertSessionBinding,
      runTurnDispatch,
      rememberSuccessfulTurnDispatch,
      persistStartedTurn,
      markThreadStopped,
    } = makeProviderRuntimeBinding({
      directory,
      registry,
      recentlyCompletedTurnsByThread,
      bindingWriteLock,
      dispatchStateByThread,
      lifecycle,
      clearRuntimeIdleTimer,
      runIdleSensitiveProviderWork,
      reconcileRuntimeIdleTimer,
      runtimeWriteState,
      latestRuntimeCursorWriteByThread,
    });
    const { processRuntimeEvent } = makeProviderRuntimeEvents({
      options,
      canonicalEventLogger,
      runtimeEventPubSub,
      reconcileRuntimeIdleTimer,
      updateSessionBindingFromRuntimeEvent,
      scheduleRetiredGatewaySessionRecovery,
      lifecycle,
      directory,
    });
    const { resolveRoutableSession, recoverSessionForThread } = makeProviderSessionRecovery({
      directory,
      lifecycle,
      registry,
      waitForLiveRuntimeTasksToSettle,
      withBindingWriteLock,
      ensureProviderEnabled,
      upsertSessionBinding,
      adapters,
    });
    const { startSession, startSessionWithOutcome, completePriorTranscriptBootstrap } =
      makeProviderSessionStartup({
        ensureProviderEnabled,
        waitForCurrentInterruptionFence,
        clearRuntimeIdleTimer,
        waitForRuntimeIdleStop,
        registry,
        directory,
        lifecycle,
        withBindingWriteLock,
        upsertSessionBinding,
        providerInterruptionFences,
      });
    const { forkThread, importExternalThread } = makeProviderSessionBranching({
      directory,
      registry,
      lifecycle,
      upsertSessionBinding,
      ensureProviderEnabled,
      waitForCurrentInterruptionFence,
      clearRuntimeIdleTimer,
      waitForRuntimeIdleStop,
      withBindingWriteLock,
    });
    const { sendTurn, steerTurn, startReview, startClaudeCompaction } = makeProviderTurnDispatch({
      runTurnDispatch,
      resolveRoutableSession,
      rememberSuccessfulTurnDispatch,
      persistStartedTurn,
    });
    const {
      stopRuntimeSessionInternal,
      stopSession,
      stopRuntimeSession,
      hasLiveRuntimeTasks,
      clearSessionResumeCursor,
    } = makeProviderSessionTeardown({
      waitForRuntimeIdleStop,
      clearRuntimeIdleTimer,
      lifecycle,
      resolveRoutableSession,
      clearLiveRuntimeTasks,
      retireRuntimeIdleGeneration,
      withBindingWriteLock,
      directory,
      providerInterruptionFences,
      isRuntimeIdleGenerationCurrent,
      registry,
      liveRuntimeTaskIds,
    });
    const {
      interruptTurn,
      stopTask,
      backgroundTask,
      steerSubagent,
      respondToRequest,
      respondToUserInput,
    } = makeProviderTaskControl({
      lifecycle,
      resolveRoutableSession,
      directory,
      targetedChildInterruptKey,
      targetedChildInterruptTombstones,
      withBindingWriteLock,
      rememberTargetedChildInterrupt,
      acquireProviderInterruptionFence,
      stopRuntimeSessionInternal,
      providerInterruptionFences,
    });
    const {
      listSessions,
      getCapabilities,
      getClaudeCacheObservation,
      rollbackConversation,
      compactThread,
    } = makeProviderSessionReads({
      adapters,
      directory,
      resolveRoutableSession,
      registry,
      runIdleSensitiveProviderWork,
    });

    yield* Ref.set(
      scheduleRetiredGatewaySessionRecovery,
      makeProviderScheduledRecoveryCallback({
        retiredGatewaySessionRecoveries,
        directory,
        recoverSessionForThread,
        runtimeEventProducerScope,
      }),
    );

    yield* Effect.forEach(adapters, (adapter) =>
      runProviderRuntimeEventPump({
        provider: adapter.provider,
        stream: adapter.streamEvents,
        processEvent: processRuntimeEvent,
        updateHealth: runtimeEventPumpHealth.update,
        isPermanentFailure: (cause) =>
          Option.match(Cause.findErrorOption(cause), {
            onNone: () => false,
            onSome: (error) => Schema.is(PersistenceDecodeError)(error),
          }),
        ...(options?.quarantineRuntimeEvent !== undefined
          ? { quarantineEvent: options.quarantineRuntimeEvent }
          : {}),
        ...(options?.runtimeEventRetryBaseDelayMs !== undefined
          ? { retryBaseDelayMs: options.runtimeEventRetryBaseDelayMs }
          : {}),
        ...(options?.runtimeEventRetryMaxDelayMs !== undefined
          ? { retryMaxDelayMs: options.runtimeEventRetryMaxDelayMs }
          : {}),
      }).pipe(Effect.forkIn(runtimeEventProducerScope)),
    ).pipe(Effect.asVoid);

    yield* Ref.set(
      stopIdleRuntimeSession,
      makeProviderIdleStopCallback({
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
      }),
    );

    const runStopAll = () =>
      Effect.gen(function* () {
        const stoppedAt = new Date().toISOString();
        const runtimeCursorWriteBaseline = yield* Ref.modify(runtimeWriteState, (state) => [
          state.cursorWriteVersion,
          { ...state, shutdownStartedAt: stoppedAt },
        ]);
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
            bindingWriteLock.withLockQueued(
              session.threadId,
              Effect.gen(function* () {
                const latestSession = (yield* adapter.listSessions()).find(
                  (candidate) => candidate.threadId === session.threadId,
                );
                const queuedCursorWrite = latestRuntimeCursorWriteByThread.get(session.threadId);
                const queuedResumeCursor =
                  queuedCursorWrite !== undefined &&
                  queuedCursorWrite.version > runtimeCursorWriteBaseline
                    ? queuedCursorWrite.resumeCursor
                    : undefined;
                const stoppedSession = latestSession ?? session;
                const resumeCursor =
                  latestSession?.resumeCursor ?? queuedResumeCursor ?? session.resumeCursor;
                yield* markThreadStopped(
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
            (threadId) => withBindingWriteLock(threadId, markThreadStopped(threadId, stoppedAt)),
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

    const awaitRuntimeEventFanoutDrained: Effect.Effect<void> = Effect.suspend(() =>
      PubSub.isEmpty(runtimeEventPubSub).pipe(
        Effect.flatMap((empty) =>
          empty
            ? Effect.void
            : Effect.yieldNow.pipe(Effect.andThen(awaitRuntimeEventFanoutDrained)),
        ),
      ),
    );

    const closeRuntimeEvents = yield* Effect.cached(
      Effect.uninterruptible(
        Effect.sync(() => {
          for (const timer of runtimeIdleTimers.values()) {
            clearTimeout(timer);
          }
          runtimeIdleTimers.clear();
          for (const threadId of new Set([
            ...liveRuntimeTaskIds.keys(),
            ...runtimeTaskSettlementWaiters.keys(),
          ])) {
            clearLiveRuntimeTasks(threadId);
          }
          runtimeIdleGenerations.clear();
          runtimeIdleCleanupGenerations.clear();
          runtimeIdleStopsInFlight.clear();
        }).pipe(
          Effect.andThen(Ref.set(stopIdleRuntimeSession, null)),
          Effect.andThen(
            runStopAll().pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to stop provider sessions", {
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
          ),
          // Keep subscriptions alive until adapters have emitted terminal events. Closing waits for an
          // in-flight canonical event because its persistence and publication section is uninterruptible.
          Effect.andThen(Scope.close(runtimeEventProducerScope, Exit.void)),

          Effect.andThen(awaitRuntimeEventFanoutDrained),
          Effect.andThen(PubSub.shutdown(runtimeEventPubSub)),
        ),
      ),
    );

    yield* Effect.addFinalizer(() => closeRuntimeEvents);

    return {
      startSession,
      startSessionWithOutcome,
      completePriorTranscriptBootstrap,
      forkThread,
      importExternalThread,
      sendTurn,
      steerTurn,
      startReview,
      interruptTurn,
      stopTask,
      backgroundTask,
      steerSubagent,
      respondToRequest,
      respondToUserInput,
      stopSession,
      stopRuntimeSession,
      hasLiveRuntimeTasks,
      clearSessionResumeCursor,
      listSessions,
      getCapabilities,
      getClaudeCacheObservation,
      startClaudeCompaction,
      rollbackConversation,
      compactThread,
      closeRuntimeEvents,
      getRuntimeEventPumpHealth: () => Effect.sync(runtimeEventPumpHealth.snapshot),

      get streamEvents(): ProviderServiceShape["streamEvents"] {
        return Stream.fromPubSub(runtimeEventPubSub).pipe(Stream.map(({ event }) => event));
      },
      ...(options?.persistRuntimeEvent === undefined
        ? {}
        : {
            get streamPersistedEvents(): NonNullable<
              ProviderServiceShape["streamPersistedEvents"]
            > {
              return Stream.fromPubSub(runtimeEventPubSub).pipe(
                Stream.filter(
                  (
                    published,
                  ): published is PublishedRuntimeEvent & {
                    readonly persisted: PersistedProviderRuntimeEvent;
                  } => published.persisted !== undefined,
                ),
                Stream.map(({ persisted }) => persisted),
              );
            },
          }),
    } satisfies ProviderServiceShape;
  });

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}

export function makeDurableProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(
    ProviderService,
    Effect.gen(function* () {
      const runtimeEvents = yield* ProviderRuntimeEventRepository;
      return yield* makeProviderService({
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
