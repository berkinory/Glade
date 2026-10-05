import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryWriteError,
} from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeKeyedLock } from "../core/keyedLock";
import type { StartedTurnPersistenceInput } from "../core/providerRuntimeBinding.ts";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";
import { Ref } from "effect";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import {
  toRuntimeStatus,
  toRuntimePayloadFromSession,
  shouldRefreshResumeCursorForEvent,
  readPersistedComputerControl,
  isTerminalRuntimeEvent,
  runtimeActiveTurnId,
  runtimeLastErrorForEvent,
  runtimeStatusForEvent,
  runtimeEventRetiredGatewayTurnAuthority,
} from "../core/providerRuntimeBinding";
import { Effect, Cause, Option, Layer } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import {
  isStartedTurnApplicable,
  classifyTerminalTurnApplicability,
} from "../core/terminalTurnApplicability.ts";
import { AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED } from "../../agentGateway/sessionLease.ts";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";

interface ThreadDispatchState {
  nextGeneration: number;
  latestGeneration: number;
  ownerGeneration: number;
  readonly inFlightGenerations: Set<number>;
  readonly outstandingTurnIds: Set<string>;
  readonly successfulResults: Map<number, StartedTurnPersistenceInput>;
}

export const ProviderRuntimeBindingsLive = Layer.effect(
  ProviderRuntimeBindings,
  Effect.gen(function* () {
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const lifecycle = yield* ProviderLifecycle;
    const idle = yield* ProviderIdleRuntime;
    const state = yield* Ref.make({
      // Overlapping sends need one marker per settled turn until their delayed running write completes.
      recentlyCompletedTurnsByThread: new Map<ThreadId, Set<string>>(),
      dispatchStateByThread: new Map<ThreadId, ThreadDispatchState>(),
      latestRuntimeCursorWriteByThread: new Map<
        ThreadId,
        { readonly version: number; readonly resumeCursor: unknown }
      >(),
    });
    const {
      recentlyCompletedTurnsByThread,
      dispatchStateByThread,
      latestRuntimeCursorWriteByThread,
    } = Ref.getUnsafe(state);
    const runtimeWriteState = yield* Ref.make<{
      readonly cursorWriteVersion: number;
      readonly shutdownStartedAt?: string;
    }>({ cursorWriteVersion: 0 });
    const bindingWriteLock = makeKeyedLock<ThreadId>();
    const upsertSessionBinding = (
      session: ProviderSession,
      threadId: ThreadId,
      extra?: {
        readonly lifecycleGeneration?: string;
        readonly modelSelection?: unknown;
        readonly providerOptions?: unknown;
        readonly enableComputerControl?: boolean;
        readonly lastRuntimeEvent?: string;
        readonly lastRuntimeEventAt?: string;
        readonly runtimePayload?: Record<string, unknown>;
      },
    ) =>
      directory.upsert({
        threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(extra?.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: extra.lifecycleGeneration }
          : {}),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: {
          ...toRuntimePayloadFromSession(session, extra),
          ...extra?.runtimePayload,
        },
      });

    const markThreadStopped = (
      threadId: ThreadId,
      stoppedAt: string,
      session?: ProviderSession,
    ): Effect.Effect<void, ProviderSessionDirectoryWriteError> =>
      session
        ? directory.upsert({
            threadId,
            provider: session.provider,
            runtimeMode: session.runtimeMode,
            status: "stopped",
            ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
            runtimePayload: {
              ...toRuntimePayloadFromSession(session, {
                lastRuntimeEvent: "provider.stopAll",
                lastRuntimeEventAt: stoppedAt,
              }),
              activeTurnId: null,
            },
          })
        : directory.getProvider(threadId).pipe(
            Effect.flatMap((provider) =>
              directory.upsert({
                threadId,
                provider,
                status: "stopped",
                runtimePayload: {
                  activeTurnId: null,
                  lastRuntimeEvent: "provider.stopAll",
                  lastRuntimeEventAt: stoppedAt,
                },
              }),
            ),
          );

    const captureResumeCursorFromActiveSession = (
      event: ProviderRuntimeEvent,
    ): Effect.Effect<unknown | null | undefined> => {
      if (!shouldRefreshResumeCursorForEvent(event)) {
        return Effect.succeed(undefined);
      }

      return Effect.gen(function* () {
        const adapter = yield* registry.getByProvider(event.provider);
        const sessions = yield* adapter.listSessions();
        const activeSession = sessions.find((session) => session.threadId === event.threadId);
        return activeSession?.resumeCursor;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider.session.resume_cursor_refresh_failed", {
            threadId: event.threadId,
            provider: event.provider,
            eventType: event.type,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(undefined)),
        ),
      );
    };

    const recordRecentlyCompletedTurn = (threadId: ThreadId, turnId: string): void => {
      let turns = recentlyCompletedTurnsByThread.get(threadId);
      if (turns === undefined) {
        turns = new Set();
        recentlyCompletedTurnsByThread.set(threadId, turns);
      }
      turns.delete(turnId);
      turns.add(turnId);
    };

    const consumeRecentlyCompletedTurn = (threadId: ThreadId, turnId: string): boolean => {
      const turns = recentlyCompletedTurnsByThread.get(threadId);
      if (turns === undefined || !turns.has(turnId)) {
        return false;
      }
      turns.delete(turnId);
      if (turns.size === 0) {
        recentlyCompletedTurnsByThread.delete(threadId);
      }
      return true;
    };

    const withBindingWriteLock = bindingWriteLock.withLock;

    const getDispatchState = (threadId: ThreadId): ThreadDispatchState => {
      let state = dispatchStateByThread.get(threadId);
      if (!state) {
        state = {
          nextGeneration: 0,
          latestGeneration: 0,
          ownerGeneration: 0,
          inFlightGenerations: new Set(),
          outstandingTurnIds: new Set(),
          successfulResults: new Map(),
        };
        dispatchStateByThread.set(threadId, state);
      }
      return state;
    };

    const beginTurnDispatch = (threadId: ThreadId): number => {
      const state = getDispatchState(threadId);
      const generation = state.nextGeneration + 1;
      state.nextGeneration = generation;
      state.latestGeneration = generation;
      state.inFlightGenerations.add(generation);
      return generation;
    };

    const cleanupDispatchState = (threadId: ThreadId): void => {
      const state = dispatchStateByThread.get(threadId);
      if (
        state &&
        state.inFlightGenerations.size === 0 &&
        state.outstandingTurnIds.size === 0 &&
        state.successfulResults.size === 0
      ) {
        dispatchStateByThread.delete(threadId);
      }
    };

    const rememberSuccessfulTurnDispatch = (input: StartedTurnPersistenceInput): void => {
      const state = getDispatchState(input.threadId);
      state.outstandingTurnIds.add(input.turnId);
      state.successfulResults.set(input.generation, input);
    };

    const hasAmbiguousTerminalTurn = (threadId: ThreadId): boolean => {
      const state = dispatchStateByThread.get(threadId);
      return (
        state !== undefined &&
        (state.outstandingTurnIds.size > 1 ||
          state.inFlightGenerations.size > 1 ||
          (state.outstandingTurnIds.size > 0 && state.inFlightGenerations.size > 0))
      );
    };

    const persistStartedTurn = (input: StartedTurnPersistenceInput) => {
      let persistenceAttempted = false;
      const rollbackFailedPersistence = Effect.sync(() => {
        if (!persistenceAttempted) return;
        const state = dispatchStateByThread.get(input.threadId);
        state?.successfulResults.delete(input.generation);
        state?.outstandingTurnIds.delete(input.turnId);
        cleanupDispatchState(input.threadId);
      });
      const markPersistenceSucceeded = (ownsLifecycle: boolean): void => {
        const state = getDispatchState(input.threadId);
        if (ownsLifecycle) state.ownerGeneration = input.generation;
        for (const generation of state.successfulResults.keys()) {
          if (generation <= input.generation) state.successfulResults.delete(generation);
        }
      };

      return withBindingWriteLock(
        input.threadId,
        Effect.gen(function* () {
          if (getDispatchState(input.threadId).latestGeneration !== input.generation) {
            return;
          }
          const existingBinding = yield* directory.getBinding(input.threadId);
          const enableComputerControl =
            Option.isSome(existingBinding) &&
            readPersistedComputerControl(existingBinding.value.runtimePayload);
          // The row must keep the generation that owned this dispatch alongside the computer-control flag,
          // atomically with the turn intent write. A retained older dispatch settling after a lifecycle
          // rotation must never regress the row: only persist a generation that is still current.
          const dispatchLifecycleGeneration =
            input.lifecycleGeneration !== undefined &&
            lifecycle.currentGeneration(input.threadId) === input.lifecycleGeneration
              ? input.lifecycleGeneration
              : undefined;
          const completedBeforePersistence = consumeRecentlyCompletedTurn(
            input.threadId,
            input.turnId,
          );
          if (completedBeforePersistence) {
            getDispatchState(input.threadId).outstandingTurnIds.delete(input.turnId);
          }
          persistenceAttempted = true;
          if (completedBeforePersistence) {
            // An existing row may already belong to a newer overlapping turn; the delayed result must not
            // overwrite any of its metadata.
            if (Option.isSome(existingBinding)) {
              markPersistenceSucceeded(false);
              return;
            }
            yield* directory.upsert({
              threadId: input.threadId,
              provider: input.provider,
              status: "stopped",
              ...(dispatchLifecycleGeneration !== undefined
                ? { lifecycleGeneration: dispatchLifecycleGeneration }
                : {}),
              ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
              ...(input.modelSelection !== undefined || enableComputerControl
                ? {
                    runtimePayload: {
                      ...(input.modelSelection !== undefined
                        ? { modelSelection: input.modelSelection }
                        : {}),
                      ...(enableComputerControl ? { enableComputerControl: true } : {}),
                    },
                  }
                : {}),
            });
            markPersistenceSucceeded(false);
            return;
          }

          idle.clearRuntimeIdleTimer(input.threadId);
          yield* directory.upsert({
            threadId: input.threadId,
            provider: input.provider,
            status: "running",
            ...(dispatchLifecycleGeneration !== undefined
              ? { lifecycleGeneration: dispatchLifecycleGeneration }
              : {}),
            ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
            runtimePayload: {
              ...(input.modelSelection !== undefined
                ? { modelSelection: input.modelSelection }
                : {}),
              ...(enableComputerControl ? { enableComputerControl: true } : {}),
              activeTurnId: input.turnId,
              lastRuntimeEvent: input.lastRuntimeEvent,
              lastRuntimeEventAt: new Date().toISOString(),
            },
          });
          markPersistenceSucceeded(true);
        }),
      ).pipe(Effect.onError(() => rollbackFailedPersistence));
    };

    const finishTurnDispatch = (
      threadId: ThreadId,
      generation: number,
    ): Effect.Effect<void, ProviderSessionDirectoryWriteError> =>
      Effect.gen(function* () {
        const candidate = yield* Effect.sync(() => {
          const state = getDispatchState(threadId);
          state.inFlightGenerations.delete(generation);
          if (state.latestGeneration === generation && !state.successfulResults.has(generation)) {
            state.latestGeneration = Math.max(
              state.ownerGeneration,
              ...state.inFlightGenerations,
              ...state.successfulResults.keys(),
            );
          }
          return state.successfulResults.get(state.latestGeneration);
        });
        if (candidate !== undefined) {
          yield* persistStartedTurn(candidate);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            const state = dispatchStateByThread.get(threadId);
            if (state?.inFlightGenerations.size === 0) {
              recentlyCompletedTurnsByThread.delete(threadId);
            }
            cleanupDispatchState(threadId);
          }),
        ),
      );

    const runTurnDispatch = <A, E, R>(
      threadId: ThreadId,
      dispatch: (generation: number) => Effect.Effect<A, E, R>,
    ) =>
      idle.runIdleSensitiveProviderWork(
        threadId,
        Effect.suspend(() => {
          const generation = beginTurnDispatch(threadId);
          return dispatch(generation).pipe(
            Effect.ensuring(finishTurnDispatch(threadId, generation).pipe(Effect.ignore)),
          );
        }),
      );

    const updateSessionBindingFromRuntimeEvent = (
      event: ProviderRuntimeEvent,
    ): Effect.Effect<void> => {
      // Their turn/session lifecycle belongs to the child thread and must not touch the parent binding —
      // a stopped subagent would otherwise clear the parent's active turn and break main-thread
      // interrupts for the rest of the turn.
      if (event.providerRefs?.providerParentThreadId !== undefined) {
        return Effect.sync(() => idle.reconcileRuntimeIdleTimer(event));
      }
      switch (event.type) {
        case "session.started":
        case "session.state.changed":
        case "thread.started":
        case "thread.state.changed":
        case "turn.started":
        case "turn.tasks.updated":
        case "model.rerouted":
        case "turn.completed":
        case "turn.aborted":
        case "session.exited":
        case "runtime.error":
          break;
        default:
          return Effect.sync(() => idle.reconcileRuntimeIdleTimer(event));
      }

      return Effect.gen(function* () {
        const liveResumeCursor = yield* captureResumeCursorFromActiveSession(event);
        yield* withBindingWriteLock(
          event.threadId,
          Effect.gen(function* () {
            if (event.type === "turn.started" && event.turnId !== undefined) {
              getDispatchState(event.threadId).outstandingTurnIds.add(String(event.turnId));
            }
            if (
              (event.type === "turn.completed" || event.type === "turn.aborted") &&
              event.turnId !== undefined &&
              (dispatchStateByThread.get(event.threadId)?.inFlightGenerations.size ?? 0) > 0
            ) {
              recordRecentlyCompletedTurn(event.threadId, String(event.turnId));
            }
            const binding = Option.getOrUndefined(yield* directory.getBinding(event.threadId));
            if (!binding) {
              idle.reconcileRuntimeIdleTimer(event);
              return;
            }
            if (binding.provider !== event.provider) {
              return;
            }
            if (
              event.lifecycleGeneration !== undefined &&
              binding.lifecycleGeneration !== event.lifecycleGeneration
            ) {
              // Mirror that acceptance here, otherwise the accepted event is journaled and published but the
              // durable binding keeps the dead turn active forever and the thread stays a reconciliation
              // candidate.
              const staleTerminalSettlesThread =
                isTerminalRuntimeEvent(event) &&
                (lifecycle.currentGeneration(event.threadId) === undefined ||
                  (event.turnId !== undefined &&
                    runtimeActiveTurnId(binding.runtimePayload) === String(event.turnId)));
              if (!staleTerminalSettlesThread) {
                return;
              }
            }

            const currentActiveTurnId = runtimeActiveTurnId(binding.runtimePayload);
            if (
              event.type === "turn.started" &&
              !isStartedTurnApplicable({
                activeTurnId: currentActiveTurnId,
                eventTurnId: event.turnId === undefined ? undefined : String(event.turnId),
              })
            ) {
              return;
            }
            if (event.type === "turn.completed" || event.type === "turn.aborted") {
              const applicability = classifyTerminalTurnApplicability({
                activeTurnId: currentActiveTurnId,
                eventTurnId: event.turnId === undefined ? undefined : String(event.turnId),
                hasAmbiguousTurns: hasAmbiguousTerminalTurn(event.threadId),
              });
              if (!applicability.applicable) {
                if (event.turnId !== undefined) {
                  dispatchStateByThread
                    .get(event.threadId)
                    ?.outstandingTurnIds.delete(String(event.turnId));
                  cleanupDispatchState(event.threadId);
                }
                if (applicability.reason === "ambiguous-missing-turn-id") {
                  yield* Effect.logWarning("provider.session.ambiguous_terminal_event_ignored", {
                    threadId: event.threadId,
                    eventType: event.type,
                  });
                }
                return;
              }
              if (event.turnId === undefined && applicability.resolvedTurnId !== undefined) {
                recordRecentlyCompletedTurn(event.threadId, applicability.resolvedTurnId);
              }
              if (applicability.resolvedTurnId !== undefined) {
                dispatchStateByThread
                  .get(event.threadId)
                  ?.outstandingTurnIds.delete(applicability.resolvedTurnId);
                cleanupDispatchState(event.threadId);
              }
            }
            const activeTurnId =
              event.type === "turn.started"
                ? (event.turnId ?? null)
                : event.type === "thread.state.changed" && event.payload.state === "compacted"
                  ? (event.turnId ?? currentActiveTurnId)
                  : event.type === "turn.completed" ||
                      event.type === "turn.aborted" ||
                      (event.type === "thread.state.changed" &&
                        (event.payload.state === "archived" ||
                          event.payload.state === "closed" ||
                          event.payload.state === "error")) ||
                      event.type === "session.exited" ||
                      event.type === "runtime.error" ||
                      (event.type === "session.state.changed" &&
                        (event.payload.state === "ready" ||
                          event.payload.state === "stopped" ||
                          event.payload.state === "error"))
                    ? null
                    : currentActiveTurnId;
            const lastError = runtimeLastErrorForEvent(event);
            const resumeCursor = liveResumeCursor ?? binding.resumeCursor;
            const eventStatus = runtimeStatusForEvent(event, activeTurnId);

            const preserveShutdownStop =
              Ref.getUnsafe(runtimeWriteState).shutdownStartedAt !== undefined &&
              eventStatus === "running";

            yield* directory.upsert({
              threadId: event.threadId,
              provider: binding.provider,
              ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
              ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
              status: preserveShutdownStop ? "stopped" : eventStatus,
              ...(resumeCursor !== undefined ? { resumeCursor } : {}),
              runtimePayload: {
                ...(readPersistedComputerControl(binding.runtimePayload)
                  ? { enableComputerControl: true }
                  : {}),
                activeTurnId: preserveShutdownStop ? null : activeTurnId,
                ...(event.type === "turn.started" && event.turnId !== undefined
                  ? { lastNativeTurnId: String(event.turnId) }
                  : {}),
                lastRuntimeEvent: preserveShutdownStop ? "provider.stopAll" : event.type,
                lastRuntimeEventAt: preserveShutdownStop
                  ? Ref.getUnsafe(runtimeWriteState).shutdownStartedAt
                  : event.createdAt,
                ...(lastError !== undefined ? { lastError } : {}),
                ...(runtimeEventRetiredGatewayTurnAuthority(event)
                  ? { [AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED]: true }
                  : {}),
              },
            });
            if (liveResumeCursor !== undefined && liveResumeCursor !== null) {
              const runtimeCursorWriteVersion = yield* Ref.modify(runtimeWriteState, (state) => {
                const version = state.cursorWriteVersion + 1;
                return [version, { ...state, cursorWriteVersion: version }];
              });
              latestRuntimeCursorWriteByThread.set(event.threadId, {
                version: runtimeCursorWriteVersion,
                resumeCursor: liveResumeCursor,
              });
            }
            if (event.type === "session.exited") {
              const dispatchState = dispatchStateByThread.get(event.threadId);
              if (dispatchState) {
                dispatchState.latestGeneration = dispatchState.nextGeneration + 1;
                dispatchState.nextGeneration = dispatchState.latestGeneration;
                dispatchState.outstandingTurnIds.clear();
                dispatchState.successfulResults.clear();
              }
              recentlyCompletedTurnsByThread.delete(event.threadId);
              cleanupDispatchState(event.threadId);
            }
            idle.reconcileRuntimeIdleTimer(event);
          }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider.session.runtime_binding_update_failed", {
            threadId: event.threadId,
            eventType: event.type,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    };
    return {
      updateSessionBindingFromRuntimeEvent,
      withBindingWriteLock,
      upsertSessionBinding,
      runTurnDispatch,
      persistDispatchedTurn: (input: StartedTurnPersistenceInput) => {
        rememberSuccessfulTurnDispatch(input);
        return persistStartedTurn(input);
      },
      markThreadStopped,
      withQueuedBindingWrite: bindingWriteLock.withLockQueued,
      beginShutdown: (stoppedAt: string) =>
        Ref.modify(runtimeWriteState, (state) => [
          state.cursorWriteVersion,
          { ...state, shutdownStartedAt: stoppedAt },
        ]),
      cursorWrittenSince: (threadId: ThreadId, baseline: number) => {
        const write = latestRuntimeCursorWriteByThread.get(threadId);
        return write !== undefined && write.version > baseline ? write.resumeCursor : undefined;
      },
    };
  }),
);
