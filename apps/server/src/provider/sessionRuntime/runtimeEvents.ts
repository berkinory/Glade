import { ProviderServiceLiveOptions } from "../core/providerServiceConfiguration";
import type { EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import { PubSub, Effect, Option } from "effect";
import type { PublishedRuntimeEvent } from "../core/providerRuntimeBinding.ts";
import { Ref } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { makeProviderLifecycleCoordinator } from "../core/providerLifecycleCoordinator.ts";
import type { ServiceMap } from "effect";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { type PersistedProviderRuntimeEvent } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { isStaleSettlingRuntimeEvent, runtimeActiveTurnId } from "../core/providerRuntimeBinding";
import { makeProviderIdleLifecycle } from "./idleLifecycle";
import { makeProviderRuntimeBinding } from "./runtimeBinding";

export function makeProviderRuntimeEvents(input: {
  readonly options: ProviderServiceLiveOptions | undefined;
  readonly canonicalEventLogger: EventNdjsonLogger | undefined;
  readonly runtimeEventPubSub: PubSub.PubSub<PublishedRuntimeEvent>;
  readonly reconcileRuntimeIdleTimer: ReturnType<
    typeof makeProviderIdleLifecycle
  >["reconcileRuntimeIdleTimer"];
  readonly updateSessionBindingFromRuntimeEvent: ReturnType<
    typeof makeProviderRuntimeBinding
  >["updateSessionBindingFromRuntimeEvent"];
  readonly scheduleRetiredGatewaySessionRecovery: Ref.Ref<
    (event: ProviderRuntimeEvent) => Effect.Effect<void>
  >;
  readonly lifecycle: ReturnType<typeof makeProviderLifecycleCoordinator>;
  readonly directory: ServiceMap.Service.Shape<typeof ProviderSessionDirectory>;
}) {
  const {
    options,
    canonicalEventLogger,
    runtimeEventPubSub,
    reconcileRuntimeIdleTimer,
    updateSessionBindingFromRuntimeEvent,
    scheduleRetiredGatewaySessionRecovery,
    lifecycle,
    directory,
  } = input;
  const persistCanonicalRuntimeEvent = (
    event: ProviderRuntimeEvent,
  ): Effect.Effect<PersistedProviderRuntimeEvent | undefined, TaggedFailure> => {
    const persistence: Effect.Effect<PersistedProviderRuntimeEvent | undefined, TaggedFailure> =
      options?.persistRuntimeEvent ? options.persistRuntimeEvent(event) : Effect.succeed(undefined);

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

  const processRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void, TaggedFailure> =>
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
                Effect.andThen(updateSessionBindingFromRuntimeEvent(acceptedEvent)),
                Effect.andThen(publishRuntimeEvent(acceptedEvent, persisted)),
                Effect.andThen(Ref.getUnsafe(scheduleRetiredGatewaySessionRecovery)(acceptedEvent)),
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
                return Effect.logInfo("provider.session.stale_generation_terminal_event_accepted", {
                  threadId: event.threadId,
                  provider: event.provider,
                  eventType: event.type,
                  eventLifecycleGeneration: event.lifecycleGeneration,
                  currentLifecycleGeneration: currentGeneration,
                }).pipe(Effect.andThen(() => journalAndPublish(canonicalEvent)));
              }),
            );
          }
        }
        return journalAndPublish(canonicalEvent);
      }),
    );
  return { processRuntimeEvent };
}
