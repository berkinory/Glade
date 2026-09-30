import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ServiceMap } from "effect";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { Option, Duration, Effect, Cause } from "effect";
import { ComputerService } from "../../computer/Services/ComputerService";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";

import { makeProviderHumanResponses } from "./humanResponses";
import { makeProviderThreadProjection } from "./threadProjection";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { ProviderQueueDrainEvent } from "./deliveryClaims";

import { type ProviderIntentEvent } from "../providerIntentClassification.ts";

import { providerFailureMessage } from "./providerCallPolicy";
import { makeProviderContextBootstrap } from "./contextBootstrap";
import { QueuedDispatchState } from "../Services/QueuedDispatchState.ts";
import { makeProviderQueuedTurns } from "./queuedTurns";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { makeProviderTaskControl } from "./taskControl";
import { makeProviderTurnStart } from "./turnStart";

import { makeProviderConversationEdit } from "./conversationEdit";

export function makeProviderDomainEvents(input: {
  readonly providerService: Pick<ProviderServiceShape, "updateNativeHistory">;
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly observePendingContextBootstrapTerminalEvent: ReturnType<
    typeof makeProviderContextBootstrap
  >["observePendingContextBootstrapTerminalEvent"];
  readonly queuedDispatchState: ServiceMap.Service.Shape<typeof QueuedDispatchState>;
  readonly drainQueuedTurnsForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["drainQueuedTurnsForSession"];
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly computerService: Option.Option<ServiceMap.Service.Shape<typeof ComputerService>>;
  readonly queuedTurnPromotions: ServiceMap.Service.Shape<typeof QueuedTurnPromotionRepository>;
  readonly clearThreadRuntimeCaches: ReturnType<
    typeof makeProviderSessionConfiguration
  >["clearThreadRuntimeCaches"];
  readonly processThreadSessionStop: ReturnType<
    typeof makeProviderTaskControl
  >["processThreadSessionStop"];

  readonly ensureSessionForThread: ReturnType<
    typeof makeProviderSessionConfiguration
  >["ensureSessionForThread"];
  readonly processTurnQueued: ReturnType<typeof makeProviderTurnStart>["processTurnQueued"];
  readonly processTurnStartRequested: ReturnType<
    typeof makeProviderTurnStart
  >["processTurnStartRequested"];

  readonly processTurnInterruptRequested: ReturnType<
    typeof makeProviderTaskControl
  >["processTurnInterruptRequested"];
  readonly processTaskStopRequested: ReturnType<
    typeof makeProviderTaskControl
  >["processTaskStopRequested"];
  readonly processTaskBackgroundRequested: ReturnType<
    typeof makeProviderTaskControl
  >["processTaskBackgroundRequested"];
  readonly processApprovalResponseRequested: ReturnType<
    typeof makeProviderHumanResponses
  >["processApprovalResponseRequested"];
  readonly processUserInputResponseRequested: ReturnType<
    typeof makeProviderHumanResponses
  >["processUserInputResponseRequested"];
  readonly processConversationRollbackRequested: ReturnType<
    typeof makeProviderConversationEdit
  >["processConversationRollbackRequested"];
  readonly processMessageEditResendRequested: ReturnType<
    typeof makeProviderConversationEdit
  >["processMessageEditResendRequested"];
  readonly setThreadSessionError: ReturnType<
    typeof makeProviderThreadProjection
  >["setThreadSessionError"];
  readonly processSessionStopRequested: ReturnType<
    typeof makeProviderTaskControl
  >["processSessionStopRequested"];
  readonly commandEventTimeout: Duration.Duration;
  readonly deliveryRepository: ServiceMap.Service.Shape<
    typeof OrchestrationEventDeliveryRepository
  >;
  readonly recoverQueuedTurnPromotionsForThread: ReturnType<
    typeof makeProviderQueuedTurns
  >["recoverQueuedTurnPromotionsForThread"];
}) {
  const {
    providerService,
    observePendingContextBootstrapTerminalEvent,
    queuedDispatchState,
    drainQueuedTurnsForSession,
    threadSessionSettings,
    computerService,
    queuedTurnPromotions,
    clearThreadRuntimeCaches,
    processThreadSessionStop,

    ensureSessionForThread,
    processTurnQueued,
    processTurnStartRequested,

    processTurnInterruptRequested,
    processTaskStopRequested,
    processTaskBackgroundRequested,
    processApprovalResponseRequested,
    processUserInputResponseRequested,
    processConversationRollbackRequested,
    processMessageEditResendRequested,
    setThreadSessionError,
    processSessionStopRequested,
    commandEventTimeout,
    deliveryRepository,
    recoverQueuedTurnPromotionsForThread,
    projectionAccess,
  } = input;
  const { resolveProviderSessionThread, hasLiveProviderTurn, resolveThread } = projectionAccess;
  const processQueueDrainEvent = Effect.fnUntraced(function* (event: ProviderQueueDrainEvent) {
    yield* observePendingContextBootstrapTerminalEvent(event);
    const sessionThreadId =
      (yield* resolveProviderSessionThread(event.threadId))?.id ?? event.threadId;
    if (queuedDispatchState.hasReservation(sessionThreadId)) {
      if (event.turnId === undefined) {
        // Keep the reservation while a turn is genuinely live; otherwise release it so queued work cannot
        // remain stranded behind an id-less terminal event.
        if (yield* hasLiveProviderTurn(event.threadId)) {
          return;
        }
        queuedDispatchState.clearReservation(sessionThreadId);
      } else {
        if (queuedDispatchState.recordTerminalTurn(sessionThreadId, event.turnId)) return;
      }
    }

    yield* drainQueuedTurnsForSession(event.threadId);
  });

  const processDomainEvent = (event: ProviderIntentEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.session-set": {
          const thread = yield* resolveThread(event.payload.threadId);
          if (
            thread &&
            event.payload.session.status !== "stopped" &&
            !threadSessionSettings.hasModelSelection(event.payload.threadId)
          ) {
            threadSessionSettings.setModelSelection(event.payload.threadId, thread.modelSelection);
          }
          return;
        }
        case "thread.created":
          threadSessionSettings.setModelSelection(
            event.payload.threadId,
            event.payload.modelSelection,
          );
          return;
        case "thread.deleted":
          if (Option.isSome(computerService))
            yield* Effect.promise(() =>
              computerService.value.manager.handleThreadRemoved(event.payload.threadId),
            );
          // Cancel any queued/promoting turns for the deleted thread BEFORE clearing runtime caches so a
          // concurrent drain cannot resurrect them (see cancelThread). Best-effort: the event stays unclaimed
          // either way.
          yield* queuedTurnPromotions.cancelThread({
            threadId: event.payload.threadId,
            updatedAt: event.payload.deletedAt,
          });
          yield* providerService
            .updateNativeHistory({ threadId: event.payload.threadId, action: { type: "delete" } })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError(
                  "Native provider history deletion failed; Glade deletion completed. No automatic retry will be made.",
                  { threadId: event.payload.threadId, cause: Cause.pretty(cause) },
                ),
              ),
            );
          yield* clearThreadRuntimeCaches(event.payload.threadId);
          return;
        case "thread.archived":
          if (Option.isSome(computerService))
            yield* Effect.promise(() =>
              computerService.value.manager.handleThreadRemoved(event.payload.threadId),
            );
          // Archive cleanup shares this durable, sequence-ordered provider source with later turn-start
          // intents. An immediate unarchive/send therefore cannot race an older archive stop against the new
          // turn.
          yield* providerService
            .updateNativeHistory({ threadId: event.payload.threadId, action: { type: "archive" } })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("Native provider history archive failed", {
                  threadId: event.payload.threadId,
                  cause: Cause.pretty(cause),
                }),
              ),
            );
          yield* processThreadSessionStop({
            threadId: event.payload.threadId,

            createdAt: event.payload.archivedAt ?? event.payload.updatedAt ?? event.occurredAt,
          });
          return;
        case "thread.unarchived":
          yield* providerService.updateNativeHistory({
            threadId: event.payload.threadId,
            action: { type: "unarchive" },
          });
          if (Option.isSome(computerService))
            yield* Effect.promise(() =>
              computerService.value.manager.handleThreadRestored(event.payload.threadId),
            );
          return;
        case "thread.meta-updated": {
          const thread = yield* resolveThread(event.payload.threadId);

          if (event.payload.modelSelection === undefined) {
            return;
          }

          if (!thread?.session || thread.session.status === "stopped") {
            threadSessionSettings.setModelSelection(
              event.payload.threadId,
              event.payload.modelSelection,
            );
            return;
          }

          if (thread.session.activeTurnId !== null) {
            return;
          }

          const cachedProviderOptions = threadSessionSettings.getProviderOptions(
            event.payload.threadId,
          );
          yield* ensureSessionForThread(event.payload.threadId, event.occurredAt, {
            modelSelection: event.payload.modelSelection,
            ...(cachedProviderOptions !== undefined
              ? { providerOptions: cachedProviderOptions }
              : {}),
          });
          threadSessionSettings.setModelSelection(
            event.payload.threadId,
            event.payload.modelSelection,
          );
          return;
        }
        case "thread.runtime-mode-set": {
          const thread = yield* resolveThread(event.payload.threadId);
          if (!thread?.session || thread.session.status === "stopped") {
            return;
          }
          if (thread.session.activeTurnId !== null) {
            return;
          }
          const cachedProviderOptions = threadSessionSettings.getProviderOptions(
            event.payload.threadId,
          );
          yield* ensureSessionForThread(event.payload.threadId, event.occurredAt, {
            ...(cachedProviderOptions !== undefined
              ? { providerOptions: cachedProviderOptions }
              : {}),
            modelSelection: thread.modelSelection,
            runtimeMode: event.payload.runtimeMode,
          });
          return;
        }
        case "thread.interaction-mode-set":
          return;
        case "thread.legacy-cache-abandoned":
          yield* drainQueuedTurnsForSession(event.payload.threadId);
          return;
        case "thread.turn-queued":
          yield* processTurnQueued(event);
          return;
        case "thread.turn-start-requested":
          yield* processTurnStartRequested(event);
          return;

        case "thread.turn-interrupt-requested":
          yield* processTurnInterruptRequested(event);
          return;
        case "thread.task-stop-requested":
          yield* processTaskStopRequested(event);
          return;
        case "thread.task-background-requested":
          yield* processTaskBackgroundRequested(event);
          return;
        case "thread.approval-response-requested":
          yield* processApprovalResponseRequested(event);
          return;
        case "thread.user-input-response-requested":
          yield* processUserInputResponseRequested(event);
          return;
        case "thread.conversation-rollback-requested":
          yield* processConversationRollbackRequested(event);
          return;
        case "thread.message-edit-resend-requested":
          yield* processMessageEditResendRequested(event).pipe(
            Effect.catchCause((cause) =>
              setThreadSessionError({
                threadId: event.payload.threadId,
                runtimeMode: event.payload.runtimeMode,
                detail: providerFailureMessage(cause),
                createdAt: event.payload.createdAt,
              }).pipe(Effect.andThen(Effect.failCause(cause))),
            ),
          );
          return;
        case "thread.session-stop-requested":
          yield* processSessionStopRequested(event);
          return;
      }
    });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.timeoutOption(commandEventTimeout),
      Effect.flatMap((completed) =>
        Option.isSome(completed)
          ? Effect.void
          : Effect.logError("provider command reactor timed out processing event", {
              eventType: event.type,
              eventSequence: event.sequence,
              threadId: event.payload.threadId,
              timeoutMs: Duration.toMillis(commandEventTimeout),
            }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const processQueueDrainEventSafely = (event: ProviderQueueDrainEvent) =>
    processQueueDrainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to drain queued turn", {
          eventType: event.type,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const recoverQueuedTurnAfterDeliverySafely = (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-queued" }>,
  ) =>
    Effect.gen(function* () {
      const delivery = yield* deliveryRepository.getDelivery({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: event.sequence,
      });
      if (Option.isNone(delivery) || delivery.value.state !== "succeeded") {
        return;
      }
      // Recovery drain: if the provider turn settled between the decider's (stale) running check and the
      // durable enqueue, its terminal runtime event has already been consumed and cannot drain this
      // queue.
      yield* recoverQueuedTurnPromotionsForThread(event.payload.threadId);
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        // The promotion row is already durable. Startup recovery or a later terminal provider event will
        // retry the drain without replaying the settled enqueue delivery.
        return Effect.logWarning("provider command reactor failed queued-turn recovery drain", {
          eventSequence: event.sequence,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  return {
    processDomainEvent,
    processDomainEventSafely,
    recoverQueuedTurnAfterDeliverySafely,
    processQueueDrainEventSafely,
  };
}
