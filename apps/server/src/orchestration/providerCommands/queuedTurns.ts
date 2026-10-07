import type { ServiceMap } from "effect";
import { Cache, Effect, Option, Stream } from "effect";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { QueuedTurnSourceEvent, PROVIDER_COMMAND_CLAIM_LEASE_MS } from "./deliveryClaims";
import { ThreadId, CommandId } from "@glade/contracts/core/baseSchemas";
import { ProviderCommandExecutionError } from "./providerCallPolicy";
import { QueuedDispatchState } from "../Services/QueuedDispatchState.ts";

export function makeProviderQueuedTurns(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly handledTurnStartKeys: Cache.Cache<string, true, never, never>;
  readonly queuedTurnPromotions: ServiceMap.Service.Shape<typeof QueuedTurnPromotionRepository>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly queuedDispatchState: ServiceMap.Service.Shape<typeof QueuedDispatchState>;
  readonly queuedTurnPromotionOwner: string;
}) {
  const {
    handledTurnStartKeys,
    queuedTurnPromotions,
    orchestrationEngine,
    queuedDispatchState,
    queuedTurnPromotionOwner,
    projectionAccess,
  } = input;
  const { resolveProviderSessionThread, resolveThread, hasLiveProviderTurn } = projectionAccess;
  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const enqueueQueuedTurnStart = (event: QueuedTurnSourceEvent) =>
    queuedTurnPromotions.enqueue({
      queuedEventSequence: event.sequence,
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
      dispatchMode: event.payload.dispatchMode,
      createdAt: event.payload.createdAt,
    });

  const hasQueuedTurnStart = (threadId: ThreadId, messageId: string) =>
    queuedTurnPromotions.hasPendingMessage({ threadId, messageId });

  const readOrchestrationEventAtSequence = (eventSequence: number) =>
    Stream.runCollect(
      orchestrationEngine.readEventsThrough(Math.max(0, eventSequence - 1), eventSequence),
    ).pipe(Effect.map((events) => Array.from(events)[0]));

  const drainQueuedTurnsForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessionThreadId = (yield* resolveProviderSessionThread(threadId))?.id ?? threadId;
    if ((yield* resolveThread(sessionThreadId))?.claudeCacheReview) return;
    if (!queuedDispatchState.beginDrain(threadId, sessionThreadId)) return;
    // `Effect.ensuring`, never a JS `finally`: a generator driven by `Effect.fnUntraced` does not
    // resume to run `finally` blocks when a yielded effect fails, so a failed promotion dispatch would
    // leak this in-flight guard and silently disable every later drain for the thread.
    yield* Effect.gen(function* () {
      const claimed = yield* queuedTurnPromotions.claimNext({
        threadId,
        claimOwner: queuedTurnPromotionOwner,
        claimedAt: new Date().toISOString(),
        claimExpiresAt: new Date(Date.now() + PROVIDER_COMMAND_CLAIM_LEASE_MS).toISOString(),
      });
      if (Option.isNone(claimed)) {
        return;
      }
      const promotion = claimed.value;
      yield* Effect.gen(function* () {
        const sourceEvent = yield* readOrchestrationEventAtSequence(promotion.queuedEventSequence);
        if (
          sourceEvent === undefined ||
          (sourceEvent.type !== "thread.turn-queued" &&
            sourceEvent.type !== "thread.turn-start-requested")
        ) {
          return yield* Effect.fail(
            new ProviderCommandExecutionError(
              `Queued turn promotion ${promotion.queuedEventSequence} has no valid source event.`,
            ),
          );
        }
        const nextQueuedTurn = sourceEvent.payload;
        queuedDispatchState.reserve(sessionThreadId, {
          queuedThreadId: threadId,
          messageId: nextQueuedTurn.messageId,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.dispatch-queued",
          commandId: CommandId.makeUnsafe(
            `server:dispatch-queued-turn:${promotion.queuedEventSequence}`,
          ),
          threadId,
          messageId: nextQueuedTurn.messageId,
          ...(nextQueuedTurn.modelSelection !== undefined
            ? { modelSelection: nextQueuedTurn.modelSelection }
            : {}),
          ...(nextQueuedTurn.providerOptions !== undefined
            ? { providerOptions: nextQueuedTurn.providerOptions }
            : {}),
          ...(nextQueuedTurn.reviewTarget !== undefined
            ? { reviewTarget: nextQueuedTurn.reviewTarget }
            : {}),
          ...(nextQueuedTurn.assistantDeliveryMode !== undefined
            ? { assistantDeliveryMode: nextQueuedTurn.assistantDeliveryMode }
            : {}),
          dispatchMode: nextQueuedTurn.dispatchMode,
          ...(nextQueuedTurn.dispatchOrigin !== undefined
            ? { dispatchOrigin: nextQueuedTurn.dispatchOrigin }
            : {}),
          runtimeMode: nextQueuedTurn.runtimeMode,

          createdAt: nextQueuedTurn.createdAt,
        });
        const promoted = yield* queuedTurnPromotions.markPromoted({
          queuedEventSequence: promotion.queuedEventSequence,
          claimOwner: queuedTurnPromotionOwner,
          promotedAt: new Date().toISOString(),
        });
        if (!promoted) {
          return yield* Effect.fail(
            new ProviderCommandExecutionError(
              `Queued turn promotion ${promotion.queuedEventSequence} lost claim ownership.`,
            ),
          );
        }
      }).pipe(
        Effect.onError(() =>
          Effect.all([
            Effect.sync(() => queuedDispatchState.clearReservation(sessionThreadId)),
            queuedTurnPromotions
              .releaseClaim({
                queuedEventSequence: promotion.queuedEventSequence,
                claimOwner: queuedTurnPromotionOwner,
                updatedAt: new Date().toISOString(),
              })
              .pipe(Effect.ignore),
          ]).pipe(Effect.asVoid),
        ),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => queuedDispatchState.endDrain(threadId))));
  });

  const drainQueuedTurnsForSession = Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessionThreadId = (yield* resolveProviderSessionThread(threadId))?.id ?? threadId;
    const queuedThreadIds = new Set<ThreadId>([threadId]);
    for (const queuedThreadId of yield* queuedTurnPromotions.listPendingThreadIds) {
      const queuedThread = ThreadId.makeUnsafe(queuedThreadId);
      const providerThread = yield* resolveProviderSessionThread(queuedThread);
      const queuedSessionThreadId = providerThread?.id ?? queuedThread;
      if (queuedSessionThreadId === sessionThreadId) {
        queuedThreadIds.add(queuedThread);
      }
    }
    for (const queuedThreadId of queuedThreadIds) {
      yield* drainQueuedTurnsForThread(queuedThreadId);
    }
  });

  const hasPendingQueuedTurnForSession = Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessionThreadId = (yield* resolveProviderSessionThread(threadId))?.id ?? threadId;
    if ((yield* resolveThread(sessionThreadId))?.claudeCacheReview) return;
    if (queuedDispatchState.hasReservation(sessionThreadId)) {
      return true;
    }
    for (const queuedThreadId of yield* queuedTurnPromotions.listPendingThreadIds) {
      const queuedThread = ThreadId.makeUnsafe(queuedThreadId);
      const providerThread = yield* resolveProviderSessionThread(queuedThread);
      if ((providerThread?.id ?? queuedThread) === sessionThreadId) {
        return true;
      }
    }
    return false;
  });

  const recoverQueuedTurnPromotionsForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const thread = yield* resolveThread(threadId);
    if (!thread || thread.deletedAt !== null) {
      yield* queuedTurnPromotions.cancelThread({
        threadId,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (yield* hasLiveProviderTurn(threadId)) {
      return;
    }
    yield* drainQueuedTurnsForThread(threadId);
  });

  const recoverQueuedTurnPromotions = Effect.gen(function* () {
    yield* Effect.forEach(yield* queuedTurnPromotions.listPendingThreadIds, (rawThreadId) =>
      recoverQueuedTurnPromotionsForThread(ThreadId.makeUnsafe(rawThreadId)),
    );
  });
  return {
    drainQueuedTurnsForSession,
    hasQueuedTurnStart,
    hasHandledTurnStartRecently,
    enqueueQueuedTurnStart,
    readOrchestrationEventAtSequence,
    hasPendingQueuedTurnForSession,
    recoverQueuedTurnPromotionsForThread,
    recoverQueuedTurnPromotions,
  };
}
