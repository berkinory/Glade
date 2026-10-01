import { Layer, Scope, Cause, Schema, Stream, Exit, Deferred, Fiber } from "effect";
import { ProviderRuntimeEvents } from "../Services/ProviderRuntimeEvents";
import type {
  ProviderServiceShape,
  ProviderRuntimeEventPumpHealth,
} from "../Services/ProviderService";
import { ProviderLifecycle } from "../Services/ProviderLifecycle";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";
import { ProviderIdleRuntime } from "../Services/ProviderIdleRuntime";
import { ProviderSessionRouting } from "../Services/ProviderSessionRouting";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry";
import { ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { makeEventNdjsonLogger } from "./EventNdjsonLogger";
import { runProviderRuntimeEventPump } from "../core/providerRuntimeEventPump";
import { PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY } from "../core/providerServiceConfiguration";
import { PersistenceDecodeError } from "../../persistence/Errors";
import { runtimeEventRetiredGatewayTurnAuthority } from "../core/providerRuntimeBinding";
import { ProviderServiceLiveOptions } from "../core/providerServiceConfiguration";
import { PubSub, Effect, Option } from "effect";
import type { PublishedRuntimeEvent } from "../core/providerRuntimeBinding.ts";
import { Ref } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { type PersistedProviderRuntimeEvent } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { isStaleSettlingRuntimeEvent, runtimeActiveTurnId } from "../core/providerRuntimeBinding";

export function ProviderRuntimeEventsLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(
    ProviderRuntimeEvents,
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const lifecycle = yield* ProviderLifecycle;
      const bindings = yield* ProviderRuntimeBindings;
      const { reconcileRuntimeIdleTimer } = yield* ProviderIdleRuntime;
      const registry = yield* ProviderAdapterRegistry;
      const { recoverSessionForThread } = yield* ProviderSessionRouting;
      const canonicalEventLogger =
        options?.canonicalEventLogger ??
        (options?.canonicalEventLogPath !== undefined
          ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, { stream: "canonical" })
          : undefined);
      const capacity = Math.max(
        1,
        Math.floor(options?.runtimeEventBufferCapacity ?? PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY),
      );
      const runtimeEventPubSub = yield* PubSub.bounded<PublishedRuntimeEvent>(capacity);
      const runtimeEventProducerScope = yield* Scope.make("sequential");
      const stopPumps = yield* Deferred.make<void>();
      const pumpFibers: Array<Fiber.Fiber<void>> = [];
      const providers = yield* registry.listProviders();
      const adapters = yield* Effect.forEach(providers, (provider) =>
        registry.getByProvider(provider),
      );
      const healthState = yield* Ref.make(
        new Map<ProviderKind, ProviderRuntimeEventPumpHealth>(
          providers.map((provider) => [
            provider,
            {
              provider,
              status: "starting",
              consecutiveFailures: 0,
              updatedAt: new Date().toISOString(),
            },
          ]),
        ),
      );
      const recoveries = yield* Ref.make(new Set<ThreadId>());
      const retiredGatewaySessionRecoveries = Ref.getUnsafe(recoveries);
      const persistedBatchEvents = new Map<string, PersistedProviderRuntimeEvent>();
      const persistCanonicalRuntimeEvent = (
        event: ProviderRuntimeEvent,
      ): Effect.Effect<PersistedProviderRuntimeEvent | undefined, TaggedFailure> => {
        const batched = persistedBatchEvents.get(event.eventId);
        persistedBatchEvents.delete(event.eventId);
        const persistence: Effect.Effect<PersistedProviderRuntimeEvent | undefined, TaggedFailure> =
          batched !== undefined
            ? Effect.succeed(batched)
            : options?.persistRuntimeEvent
              ? options.persistRuntimeEvent(event)
              : Effect.succeed(undefined);

        return Effect.uninterruptible(
          persistence.pipe(
            Effect.tap(() =>
              canonicalEventLogger ? canonicalEventLogger.write(event, null) : Effect.void,
            ),
          ),
        );
      };

      const publishRuntimeEvent = (
        event: ProviderRuntimeEvent,
        persisted: PersistedProviderRuntimeEvent | undefined,
      ): Effect.Effect<void> =>
        PubSub.publish(runtimeEventPubSub, {
          event,
          ...(persisted === undefined ? {} : { persisted }),
        }).pipe(Effect.asVoid);

      const processRuntimeEvent = (
        event: ProviderRuntimeEvent,
      ): Effect.Effect<void, TaggedFailure> =>
        Effect.uninterruptible(
          Effect.suspend(() => {
            const journalAndPublish = (acceptedEvent: ProviderRuntimeEvent) =>
              persistCanonicalRuntimeEvent(acceptedEvent).pipe(
                Effect.flatMap((persisted) =>
                  Effect.sync(() => {
                    if (acceptedEvent.type === "turn.started") {
                      reconcileRuntimeIdleTimer(acceptedEvent);
                    }
                  }).pipe(
                    Effect.andThen(bindings.updateSessionBindingFromRuntimeEvent(acceptedEvent)),
                    Effect.andThen(publishRuntimeEvent(acceptedEvent, persisted)),
                    Effect.andThen(scheduleRetiredGatewaySessionRecovery(acceptedEvent)),
                  ),
                ),
              );
            const canonicalEvent = event;
            if (
              event.lifecycleGeneration !== undefined &&
              lifecycle.currentGeneration(event.threadId) !== event.lifecycleGeneration
            ) {
              const currentGeneration = lifecycle.currentGeneration(event.threadId);
              // Stale generations may still settle their active turn and matching durable interactions. Admit
              // terminal events only without a newer generation or for the binding's active turn; projection
              // generation checks prevent old resolutions from settling newer requests.
              const staleEventIsSettling =
                isStaleSettlingRuntimeEvent(event) &&
                (currentGeneration === undefined || event.turnId !== undefined);
              if (!staleEventIsSettling) {
                return Effect.logWarning("provider.session.stale_generation_event_ignored", {
                  threadId: event.threadId,
                  provider: event.provider,
                  eventType: event.type,
                  eventLifecycleGeneration: event.lifecycleGeneration,
                  currentLifecycleGeneration: currentGeneration,
                });
              }
              if (currentGeneration !== undefined) {
                return directory.getBinding(event.threadId).pipe(
                  Effect.flatMap((maybeBinding) => {
                    const binding = Option.getOrUndefined(maybeBinding);
                    const boundActiveTurnId = binding
                      ? runtimeActiveTurnId(binding.runtimePayload)
                      : undefined;
                    if (binding === undefined || boundActiveTurnId !== String(event.turnId)) {
                      return Effect.logWarning("provider.session.stale_generation_event_ignored", {
                        threadId: event.threadId,
                        provider: event.provider,
                        eventType: event.type,
                        eventLifecycleGeneration: event.lifecycleGeneration,
                        currentLifecycleGeneration: currentGeneration,
                      });
                    }
                    return Effect.logInfo(
                      "provider.session.stale_generation_terminal_event_accepted",
                      {
                        threadId: event.threadId,
                        provider: event.provider,
                        eventType: event.type,
                        eventLifecycleGeneration: event.lifecycleGeneration,
                        currentLifecycleGeneration: currentGeneration,
                      },
                    ).pipe(Effect.andThen(() => journalAndPublish(canonicalEvent)));
                  }),
                );
              }
            }
            return journalAndPublish(canonicalEvent);
          }),
        );
      const processRuntimeEventBatch = (
        events: ReadonlyArray<ProviderRuntimeEvent>,
        processEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (let index = 0; index < events.length; ) {
            const event = events[index]!;
            if (event.type !== "content.delta") {
              yield* processEvent(event);
              index++;
              continue;
            }
            const deltas: ProviderRuntimeEvent[] = [];
            while (index < events.length && events[index]!.type === "content.delta") {
              deltas.push(events[index++]!);
            }
            // Deltas do not mutate session bindings. Lifecycle events remain sequential barriers.
            const accepted = deltas.filter(
              (delta) =>
                delta.lifecycleGeneration === undefined ||
                lifecycle.currentGeneration(delta.threadId) === delta.lifecycleGeneration,
            );
            if (accepted.length > 1 && options?.persistRuntimeEventBatch) {
              yield* options.persistRuntimeEventBatch(accepted).pipe(
                Effect.tap((stored) =>
                  Effect.sync(() => {
                    for (const row of stored) persistedBatchEvents.set(row.event.eventId, row);
                  }),
                ),
                // Preserve per-event retry/quarantine on a bad row or failed transaction.
                Effect.catch(() => Effect.void),
              );
            }
            yield* Effect.forEach(deltas, processEvent, { discard: true }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  for (const delta of deltas) persistedBatchEvents.delete(delta.eventId);
                }),
              ),
            );
          }
        });

      const scheduleRetiredGatewaySessionRecovery = (
        event: ProviderRuntimeEvent,
      ): Effect.Effect<void> => {
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
      const awaitRuntimeEventFanoutDrained: Effect.Effect<void> = Effect.suspend(() =>
        PubSub.isEmpty(runtimeEventPubSub).pipe(
          Effect.flatMap((empty) =>
            empty
              ? Effect.void
              : Effect.yieldNow.pipe(Effect.andThen(awaitRuntimeEventFanoutDrained)),
          ),
        ),
      );
      return {
        startPumps: Effect.forEach(adapters, (adapter) =>
          runProviderRuntimeEventPump({
            provider: adapter.provider,
            stream: adapter.streamEvents.pipe(Stream.interruptWhen(Deferred.await(stopPumps))),
            isStopping: Deferred.isDone(stopPumps),
            processEvent: processRuntimeEvent,
            ...(options?.persistRuntimeEventBatch
              ? { processBatch: processRuntimeEventBatch }
              : {}),
            updateHealth: (health) => Ref.getUnsafe(healthState).set(health.provider, health),
            isPermanentFailure: (cause) =>
              Option.match(Cause.findErrorOption(cause), {
                onNone: () => false,
                onSome: (error) => Schema.is(PersistenceDecodeError)(error),
              }),
            ...(options?.quarantineRuntimeEvent !== undefined
              ? { quarantineEvent: options.quarantineRuntimeEvent }
              : {}),
            ...(options?.runtimeEventRetry !== undefined
              ? { retry: options.runtimeEventRetry }
              : {}),
          }).pipe(Effect.forkIn(runtimeEventProducerScope)),
        ).pipe(
          Effect.tap((fibers) => Effect.sync(() => pumpFibers.push(...fibers))),
          Effect.asVoid,
        ),
        shutdown: Deferred.succeed(stopPumps, undefined).pipe(
          Effect.andThen(Effect.forEach(pumpFibers, Fiber.join, { discard: true })),
          Effect.andThen(Scope.close(runtimeEventProducerScope, Exit.void)),
          Effect.andThen(awaitRuntimeEventFanoutDrained),
          Effect.andThen(PubSub.shutdown(runtimeEventPubSub)),
        ),
        getRuntimeEventPumpHealth: () =>
          Effect.sync(() =>
            providers.map((provider) => {
              const current = Ref.getUnsafe(healthState).get(provider);
              if (!current)
                throw new Error(`Missing runtime-event pump health for provider '${provider}'.`);
              return current;
            }),
          ),
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
      };
    }),
  );
}
