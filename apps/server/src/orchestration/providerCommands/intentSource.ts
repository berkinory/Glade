import type { ServiceMap } from "effect";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
  type ProviderBlockingDeliveryEvidence,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeProviderThreadProjection } from "./threadProjection";
import { Duration, Effect, Queue, Cause, Stream, Option } from "effect";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { awaitInflightClaimSettlement, PROVIDER_COMMAND_CLAIM_LEASE_MS } from "./deliveryClaims";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  type ProviderIntentEvent,
  isProviderSideEffectIntent,
  isQuarantineExemptProviderIntent,
  isReplaySafeClaimedProviderIntent,
  isProviderIntentEvent,
  isClaimedProviderIntent,
} from "../providerIntentClassification.ts";
import {
  PROVIDER_DELIVERY_BLOCK_SUMMARY,
  formatProviderDeliveryBlockDetail,
} from "@glade/shared/provider/providerDeliveryBlock";
import {
  runBoundedProviderCall,
  ProviderAttemptOutcome,
  PROVIDER_COMMAND_SAFE_RETRY_LIMIT,
  PROVIDER_COMMAND_SAFE_RETRY_DELAY,
  isSafeLegacyProviderBlocker,
} from "./providerCallPolicy";
import { makeProviderDomainEvents } from "./domainEvents";
import { makeProviderQueuedTurns } from "./queuedTurns";

export function makeProviderIntentSource(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly deliveryRepository: ServiceMap.Service.Shape<
    typeof OrchestrationEventDeliveryRepository
  >;
  readonly deliveryGate: ServiceMap.Service.Shape<typeof ProviderDeliveryGate>;
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly setThreadSessionError: ReturnType<
    typeof makeProviderThreadProjection
  >["setThreadSessionError"];
  readonly commandEventTimeout: Duration.Duration;
  readonly processDomainEvent: ReturnType<typeof makeProviderDomainEvents>["processDomainEvent"];
  readonly surfaceTimedOutTurnStart: ReturnType<
    typeof makeProviderThreadProjection
  >["surfaceTimedOutTurnStart"];
  readonly surfaceTimedOutGoalContinuation: ReturnType<
    typeof makeProviderThreadProjection
  >["surfaceTimedOutGoalContinuation"];
  readonly gatewayOperations: ServiceMap.Service.Shape<typeof AgentGatewayOperationRepository>;
  readonly processDomainEventSafely: ReturnType<
    typeof makeProviderDomainEvents
  >["processDomainEventSafely"];
  readonly recoverQueuedTurnAfterDeliverySafely: ReturnType<
    typeof makeProviderDomainEvents
  >["recoverQueuedTurnAfterDeliverySafely"];
  readonly readOrchestrationEventAtSequence: ReturnType<
    typeof makeProviderQueuedTurns
  >["readOrchestrationEventAtSequence"];
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
}) {
  const {
    orchestrationEngine,
    deliveryRepository,
    deliveryGate,
    appendProviderFailureActivity,
    setThreadSessionError,
    commandEventTimeout,
    processDomainEvent,
    surfaceTimedOutTurnStart,
    surfaceTimedOutGoalContinuation,
    gatewayOperations,
    processDomainEventSafely,
    recoverQueuedTurnAfterDeliverySafely,
    readOrchestrationEventAtSequence,
    setThreadSession,
    projectionAccess,
  } = input;
  const { resolveThread } = projectionAccess;
  const startProviderIntentSource = Effect.gen(function* () {
    const liveEventSource = yield* orchestrationEngine.subscribeDomainEvents;
    // Preserve the source/consumer handoff without retaining an unbounded event mirror while startup or
    // a provider call runs. The engine replays overflow.
    const liveEventQueue = yield* Queue.bounded<OrchestrationEvent, Cause.Done>(1);
    yield* Stream.runIntoQueue(liveEventSource, liveEventQueue).pipe(Effect.forkScoped);
    const liveEvents = Stream.fromQueue(liveEventQueue);
    const consumerState = yield* deliveryRepository.getConsumerState(
      PROVIDER_COMMAND_REACTOR_CONSUMER,
    );
    if (Option.isNone(consumerState)) {
      return yield* Effect.die(
        new Error(`Missing durable consumer state for ${PROVIDER_COMMAND_REACTOR_CONSUMER}`),
      );
    }

    const processOwner = `provider-command-reactor:${crypto.randomUUID()}`;
    let cursor = consumerState.value.lastAckedSequence;
    const refreshCursor = Effect.gen(function* () {
      const state = yield* deliveryRepository.getConsumerState(PROVIDER_COMMAND_REACTOR_CONSUMER);
      if (Option.isSome(state)) cursor = state.value.lastAckedSequence;
    });

    const advanceCursor = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      const advanced = yield* deliveryRepository.advanceCursor({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: event.sequence,
        updatedAt: new Date().toISOString(),
      });
      if (advanced) cursor = event.sequence;
      return advanced;
    });

    const requireCursorAdvance = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (yield* advanceCursor(event)) return;
      yield* refreshCursor;
      if (cursor < event.sequence) {
        return yield* Effect.die(
          new Error(`Provider command cursor could not advance through event ${event.sequence}`),
        );
      }
    });

    const isThreadQuarantined = Effect.fnUntraced(function* (threadId: string) {
      if (deliveryGate.isQuarantined(threadId)) return true;
      const blocker = yield* deliveryRepository.firstBlockingDeliveryForThread({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        threadId,
      });
      if (Option.isNone(blocker)) return false;
      deliveryGate.quarantine(threadId);
      return true;
    });

    const settleTerminalFailure = Effect.fnUntraced(function* (input: {
      readonly event: ProviderIntentEvent;
      readonly claimOwner: string;
      readonly state: "dead" | "uncertain";
      readonly detail: string;
    }) {
      deliveryGate.clearCompletionContext(input.event.sequence);
      yield* Effect.logError("provider command delivery entered terminal failure", {
        eventType: input.event.type,
        eventSequence: input.event.sequence,
        threadId: input.event.payload.threadId,
        state: input.state,
        detail: input.detail,
      });
      const settled = yield* deliveryRepository.markTerminalFailure({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: input.event.sequence,
        expectedClaimOwner: input.claimOwner,
        state: input.state,
        error: input.detail,
        updatedAt: new Date().toISOString(),
      });
      if (!settled) {
        return yield* Effect.die(
          new Error(
            `Provider command delivery ${input.event.sequence} lost terminal settlement ownership`,
          ),
        );
      }
      deliveryGate.quarantine(input.event.payload.threadId);
      yield* requireCursorAdvance(input.event);
    });

    const skipQuarantinedSideEffect = Effect.fnUntraced(function* (event: ProviderIntentEvent) {
      if (
        !isProviderSideEffectIntent(event) ||
        isQuarantineExemptProviderIntent(event) ||
        !(yield* isThreadQuarantined(event.payload.threadId))
      ) {
        return false;
      }
      yield* Effect.logWarning("provider command skipped for quarantined thread", {
        eventType: event.type,
        eventSequence: event.sequence,
        threadId: event.payload.threadId,
      });

      if (
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.message-edit-resend-requested"
      ) {
        yield* Effect.gen(function* () {
          const blocker = yield* deliveryRepository.firstBlockingDeliveryForThread({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            threadId: event.payload.threadId,
          });
          const blockerDetail =
            Option.isSome(blocker) && blocker.value.lastError !== null
              ? blocker.value.lastError
              : "an earlier provider command failed";
          const createdAt = new Date().toISOString();
          yield* appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.turn.start.failed",
            summary: PROVIDER_DELIVERY_BLOCK_SUMMARY,
            detail: `The message was not sent to the provider. Blocking failure: ${blockerDetail}`,
            turnId: null,
            createdAt,
          });
          yield* setThreadSessionError({
            threadId: event.payload.threadId,
            detail: formatProviderDeliveryBlockDetail(blockerDetail),
            createdAt,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to surface quarantined-thread skip", {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
      yield* requireCursorAdvance(event);
      return true;
    });

    const processClaimedProviderIntent = Effect.fnUntraced(function* (event: ProviderIntentEvent) {
      const threadId = event.payload.threadId;
      if (yield* skipQuarantinedSideEffect(event)) return;

      let existing = yield* deliveryRepository.getDelivery({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: event.sequence,
      });
      while (Option.isSome(existing)) {
        if (existing.value.state === "succeeded") {
          yield* requireCursorAdvance(event);
          return;
        }
        if (existing.value.state === "dead" || existing.value.state === "uncertain") {
          deliveryGate.quarantine(threadId);
          yield* requireCursorAdvance(event);
          return;
        }
        if (existing.value.state === "inflight") {
          const expiresAt = Date.parse(existing.value.claimExpiresAt ?? "");
          const remainingMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
          if (remainingMs > 0) {
            const waitStartedAt = Date.now();
            let lastKnown = Option.getOrUndefined(existing);
            const latest = yield* awaitInflightClaimSettlement({
              readClaim: () =>
                deliveryRepository
                  .getDelivery({
                    consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                    eventSequence: event.sequence,
                  })
                  .pipe(
                    Effect.map((record) => {
                      lastKnown = Option.getOrUndefined(record);
                      return Option.getOrUndefined(record);
                    }),
                    Effect.orElseSucceed(() => lastKnown),
                  ),
              deadlineMs: remainingMs,
            });
            if (latest?.state === "succeeded") {
              const waitedMs = Date.now() - waitStartedAt;
              yield* Effect.logDebug(
                "provider command delivery settled while waiting out a prior claim",
                {
                  eventSequence: event.sequence,
                  threadId,
                  waitedMs,
                  savedMs: Math.max(0, remainingMs - waitedMs),
                },
              );
            }

            existing = yield* deliveryRepository.getDelivery({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: event.sequence,
            });
            continue;
          }
          const expiredOwner = existing.value.claimOwner ?? "";
          if (!isReplaySafeClaimedProviderIntent(event)) {
            yield* settleTerminalFailure({
              event,
              claimOwner: expiredOwner,
              state: "uncertain",
              detail:
                "External provider command claim expired without a durable acceptance result; execution was not replayed.",
            });
            return;
          }
          const requeued = yield* deliveryRepository.requeueExpired({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence: event.sequence,
            expectedClaimOwner: expiredOwner,
            now: new Date().toISOString(),
            error: "Replay-safe provider command claim expired before settlement.",
          });
          if (!requeued) {
            return yield* Effect.die(
              new Error(
                `Replay-safe provider command delivery ${event.sequence} could not be requeued`,
              ),
            );
          }
        }
        break;
      }

      while (true) {
        const claimOwner = `${processOwner}:${event.sequence}`;
        const claimed = yield* deliveryRepository.claim({
          consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
          eventSequence: event.sequence,
          threadId,
          claimOwner,
          claimedAt: new Date().toISOString(),
          claimExpiresAt: new Date(Date.now() + PROVIDER_COMMAND_CLAIM_LEASE_MS).toISOString(),
        });
        if (Option.isNone(claimed)) {
          return yield* Effect.die(
            new Error(`Provider command delivery ${event.sequence} could not be claimed`),
          );
        }

        const workerResult = yield* runBoundedProviderCall({
          label: `The provider command '${event.type}'`,
          timeout: commandEventTimeout,
          call: processDomainEvent(event),
        });
        if (workerResult._tag === "timeout") {
          // The delivery lock is single-permit and process-wide, so an attempt that never returns is a total
          // outage. Settle it as uncertain and let the thread quarantine rather than block every other
          // thread.
          if (event.type === "thread.turn-start-requested") {
            yield* surfaceTimedOutTurnStart(event, workerResult.detail).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("failed to surface timed-out provider turn start", {
                  eventSequence: event.sequence,
                  threadId: event.payload.threadId,
                  cause: Cause.pretty(cause),
                }),
              ),
            );
          } else if (event.type === "thread.goal-continuation-requested") {
            yield* surfaceTimedOutGoalContinuation(event, workerResult.detail).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("failed to surface timed-out goal continuation", {
                  eventSequence: event.sequence,
                  threadId: event.payload.threadId,
                  cause: Cause.pretty(cause),
                }),
              ),
            );
          }
          yield* settleTerminalFailure({
            event,
            claimOwner,
            state: "uncertain",
            detail: workerResult.detail,
          });
          return;
        }
        const outcome: ProviderAttemptOutcome =
          workerResult._tag === "ok" ? { _tag: "accepted" } : workerResult.outcome;

        switch (outcome._tag) {
          case "accepted":
          case "rejected": {
            if (outcome._tag === "rejected") {
              yield* Effect.logWarning("provider command was rejected before acceptance", {
                eventType: event.type,
                eventSequence: event.sequence,
                threadId,
                detail: outcome.detail,
              });
            }
            const completed = yield* gatewayOperations.completions.settleContext(
              event.sequence,
              deliveryGate.hasCompletionContext(event.sequence),
              deliveryRepository.complete({
                consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                eventSequence: event.sequence,
                claimOwner,
                completedAt: new Date().toISOString(),
              }),
            );
            if (!completed) {
              return yield* Effect.die(
                new Error(`Provider command delivery ${event.sequence} lost settlement ownership`),
              );
            }
            deliveryGate.clearCompletionContext(event.sequence);
            yield* refreshCursor;
            return;
          }
          case "safe_retry": {
            if (claimed.value.attemptCount >= PROVIDER_COMMAND_SAFE_RETRY_LIMIT) {
              yield* settleTerminalFailure({
                event,
                claimOwner,
                state: "dead",
                detail: `Safe retry budget exhausted. ${outcome.detail}`,
              });
              return;
            }
            const retryable = yield* deliveryRepository.markRetryable({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: event.sequence,
              expectedClaimOwner: claimOwner,
              error: outcome.detail,
              updatedAt: new Date().toISOString(),
            });
            if (!retryable) {
              return yield* Effect.die(
                new Error(`Provider command delivery ${event.sequence} lost retry ownership`),
              );
            }
            yield* Effect.sleep(PROVIDER_COMMAND_SAFE_RETRY_DELAY);
            break;
          }
          case "uncertain":
            yield* settleTerminalFailure({
              event,
              claimOwner,
              state: "uncertain",
              detail: outcome.detail,
            });
            return;
        }
      }
    });

    const processUnclaimedProviderIntent = Effect.fnUntraced(function* (
      event: ProviderIntentEvent,
    ) {
      if (yield* skipQuarantinedSideEffect(event)) return;
      yield* processDomainEventSafely(event);
      yield* requireCursorAdvance(event);
    });

    const processClaimedProviderIntentWithRecovery = Effect.fnUntraced(function* (
      event: ProviderIntentEvent,
    ) {
      yield* processClaimedProviderIntent(event);
      if (event.type === "thread.turn-queued") {
        yield* recoverQueuedTurnAfterDeliverySafely(event);
      }
    });

    const releaseLegacyCacheHold = Effect.fnUntraced(function* (
      event: Extract<ProviderIntentEvent, { type: "thread.legacy-cache-abandoned" }>,
    ) {
      const blocker = yield* deliveryRepository.firstBlockingDeliveryForThread({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        threadId: event.payload.threadId,
      });
      if (Option.isSome(blocker)) {
        const source = yield* readOrchestrationEventAtSequence(blocker.value.eventSequence);
        if (
          source?.type === "thread.claude-cache-response-requested" &&
          source.payload.review.reviewId === event.payload.reviewId &&
          (blocker.value.state === "dead" || blocker.value.state === "uncertain")
        ) {
          const reconciled = yield* deliveryRepository.reconcile({
            reconciliationId: crypto.randomUUID(),
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence: blocker.value.eventSequence,
            threadId: event.payload.threadId,
            expectedState: blocker.value.state,
            outcome: "abandon",
            reconciledBy: "user:legacy-cache-release",
            note: "The user released an obsolete cache review without replaying its provider command.",
            reconciledAt: event.payload.createdAt,
          });
          if (Option.isNone(reconciled)) {
            return yield* Effect.die(
              new Error(
                `Legacy cache delivery ${blocker.value.eventSequence} could not be released`,
              ),
            );
          }
          deliveryGate.releaseQuarantine(event.payload.threadId);
        }
      }
      yield* processClaimedProviderIntent(event);
    });

    const processOrderedEvent = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (event.sequence <= cursor) return;
      if (!isProviderIntentEvent(event)) {
        yield* requireCursorAdvance(event);
        return;
      }
      if (event.type === "thread.legacy-cache-abandoned") {
        yield* releaseLegacyCacheHold(event);
        return;
      }
      if (isClaimedProviderIntent(event)) {
        yield* processClaimedProviderIntentWithRecovery(event);
        return;
      }
      yield* processUnclaimedProviderIntent(event);
    });

    const readProviderIntentEvent = Effect.fnUntraced(function* (eventSequence: number) {
      const event = yield* readOrchestrationEventAtSequence(eventSequence);
      if (
        event === undefined ||
        event.sequence !== eventSequence ||
        !isProviderIntentEvent(event)
      ) {
        return yield* Effect.die(
          new Error(
            `Provider delivery ${eventSequence} has no matching provider-intent source event`,
          ),
        );
      }
      return event;
    });

    const replayQuarantinedThreadSideEffects = Effect.fnUntraced(function* (input: {
      readonly threadId: string;
      readonly afterSequence: number;
    }) {
      const replayThrough = cursor;
      if (replayThrough <= input.afterSequence) return;
      yield* Stream.runForEach(
        orchestrationEngine.readEventsThrough(input.afterSequence, replayThrough),
        (event) => {
          if (
            !isProviderIntentEvent(event) ||
            event.payload.threadId !== input.threadId ||
            !isProviderSideEffectIntent(event)
          ) {
            return Effect.void;
          }
          return isClaimedProviderIntent(event)
            ? processClaimedProviderIntentWithRecovery(event)
            : processUnclaimedProviderIntent(event);
        },
      );
    });

    const resumeRetryableDelivery = Effect.fnUntraced(function* (input: {
      readonly eventSequence: number;
      readonly threadId: string;
    }) {
      deliveryGate.releaseQuarantine(input.threadId);
      const event = yield* readProviderIntentEvent(input.eventSequence);
      if (!isClaimedProviderIntent(event)) {
        return yield* Effect.die(
          new Error(
            `Provider delivery ${input.eventSequence} does not own a claimed provider intent`,
          ),
        );
      }
      yield* processClaimedProviderIntentWithRecovery(event);
      const delivery = yield* deliveryRepository.getDelivery({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: input.eventSequence,
      });
      if (Option.isSome(delivery) && delivery.value.state === "succeeded") {
        deliveryGate.releaseQuarantine(input.threadId);
        yield* replayQuarantinedThreadSideEffects({
          threadId: input.threadId,
          afterSequence: input.eventSequence,
        });
      }
    });

    yield* deliveryGate.setReconciler((input) =>
      Effect.scoped(
        deliveryGate.withSourceLock(
          Effect.gen(function* () {
            const reconciledAt = new Date().toISOString();
            const delivery = yield* deliveryRepository.getDelivery({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: input.eventSequence,
            });
            if (
              Option.isNone(delivery) ||
              delivery.value.threadId !== input.threadId ||
              delivery.value.state !== input.expectedState
            )
              return null;
            const reconciled = yield* deliveryRepository.reconcile({
              reconciliationId: crypto.randomUUID(),
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: input.eventSequence,
              threadId: input.threadId,
              expectedState: input.expectedState,
              outcome: input.outcome,
              reconciledBy: input.reconciledBy,
              ...(input.note === undefined ? {} : { note: input.note }),
              reconciledAt,
            });
            if (Option.isNone(reconciled)) return null;

            if (input.outcome === "safe_retry") {
              yield* resumeRetryableDelivery(input);
            } else {
              deliveryGate.releaseQuarantine(input.threadId);
              yield* replayQuarantinedThreadSideEffects({
                threadId: input.threadId,
                afterSequence: input.eventSequence,
              });
            }

            const finalDelivery = yield* deliveryRepository.getDelivery({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: input.eventSequence,
            });
            if (Option.isNone(finalDelivery) || finalDelivery.value.state === "inflight") {
              return yield* Effect.die(
                new Error(
                  `Provider delivery ${input.eventSequence} did not reach a reconciled state`,
                ),
              );
            }
            return {
              eventSequence: input.eventSequence,
              threadId: input.threadId,
              outcome: input.outcome,
              state: finalDelivery.value.state,
              reconciledAt,
            };
          }),
        ),
      ),
    );

    const countSkippedPrompts = (input: {
      readonly threadId: ThreadId;
      readonly afterSequence: number;
    }) => {
      if (cursor <= input.afterSequence) return Effect.succeed(0);
      return orchestrationEngine.readEventsThrough(input.afterSequence, cursor).pipe(
        Stream.runFold(
          () => 0,
          (count: number, event) =>
            isProviderIntentEvent(event) &&
            event.payload.threadId === input.threadId &&
            (event.type === "thread.turn-start-requested" ||
              event.type === "thread.message-edit-resend-requested")
              ? count + 1
              : count,
        ),
      );
    };

    const isSettledQuitInterruptBlocker = Effect.fnUntraced(function* (
      blocker: ProviderBlockingDeliveryEvidence,
    ) {
      if (
        !blocker.lastError?.startsWith(
          "Error: Orchestration command admission is stopped (thread.activity.append, server:provider-failure-activity:",
        )
      ) {
        return false;
      }
      const intent = yield* readProviderIntentEvent(blocker.eventSequence);
      if (
        intent.type !== "thread.turn-interrupt-requested" ||
        !intent.commandId?.startsWith("quit-resume-interrupt:")
      ) {
        return false;
      }

      const highWater = yield* orchestrationEngine.getEventHighWaterSequence;
      return yield* orchestrationEngine
        .readThreadEventsThrough(blocker.threadId, blocker.eventSequence, highWater, [
          "thread.session-set",
        ])
        .pipe(
          Stream.runFold(
            () => false,
            (settled, event) => {
              if (event.type !== "thread.session-set") return settled;
              const session = event.payload.session;
              if (
                session.activeTurnId !== null ||
                session.status === "running" ||
                session.status === "ready"
              ) {
                return false;
              }
              return (
                settled ||
                (event.occurredAt <= blocker.updatedAt &&
                  session.status === "stopped" &&
                  session.lastError === null)
              );
            },
          ),
        );
    });

    const startupRecoveryNotifiedThreads = new Set<ThreadId>();
    yield* Effect.gen(function* () {
      const pageSize = 100;
      let afterEventSequence: number | undefined;
      while (true) {
        const startupBlockers = yield* deliveryRepository.listBlockingDeliveries({
          consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
          ...(afterEventSequence === undefined ? {} : { afterEventSequence }),
          limit: pageSize,
        });
        for (const blocker of startupBlockers) {
          const settledQuit = yield* isSettledQuitInterruptBlocker(blocker);
          if (!settledQuit && !isSafeLegacyProviderBlocker(blocker.lastError)) continue;
          const reconciled = yield* deliveryRepository.reconcile({
            reconciliationId: crypto.randomUUID(),
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence: blocker.eventSequence,
            threadId: blocker.threadId,
            expectedState: blocker.state,
            outcome: "abandon",
            reconciledBy: "system:provider-command-reactor",
            note: settledQuit
              ? "Intentional quit interrupt: provider stop was recorded before shutdown rejected its diagnostic; settled without replay."
              : "Recorded failure proves the provider never executed this command; settled at startup.",
            reconciledAt: new Date().toISOString(),
          });
          if (Option.isNone(reconciled)) continue;

          deliveryGate.releaseQuarantine(blocker.threadId);
          if (settledQuit) {
            const remaining = yield* deliveryRepository.firstBlockingDeliveryForThread({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              threadId: blocker.threadId,
            });
            const session = (yield* resolveThread(blocker.threadId))?.session;
            if (
              Option.isNone(remaining) &&
              session?.status === "error" &&
              session.activeTurnId === null &&
              blocker.lastError !== null &&
              session.lastError === formatProviderDeliveryBlockDetail(blocker.lastError)
            ) {
              const createdAt = new Date().toISOString();
              yield* setThreadSession({
                threadId: blocker.threadId,
                expectedSession: session,
                session: { ...session, status: "stopped", lastError: null, updatedAt: createdAt },
                createdAt,
              });
            }
          }
          if (!startupRecoveryNotifiedThreads.has(blocker.threadId)) {
            const skippedPromptCount = yield* countSkippedPrompts({
              threadId: blocker.threadId,
              afterSequence: blocker.eventSequence,
            });
            if (skippedPromptCount > 0) {
              const noun = skippedPromptCount === 1 ? "message was" : "messages were";
              const createdAt = new Date().toISOString();
              yield* appendProviderFailureActivity({
                threadId: blocker.threadId,
                kind: "provider.turn.start.failed",
                summary: "Previous messages were not sent",
                detail: `Glade recovered an earlier provider failure, but ${skippedPromptCount} ${noun} skipped while the thread was blocked. Resend ${skippedPromptCount === 1 ? "it" : "them"} to continue.`,
                turnId: null,
                createdAt,
              });
              startupRecoveryNotifiedThreads.add(blocker.threadId);
            }
          }
          yield* Effect.logInfo("provider delivery blocker auto-healed at startup", {
            eventSequence: blocker.eventSequence,
            threadId: blocker.threadId,
            lastError: blocker.lastError,
          });
        }
        if (startupBlockers.length < pageSize) break;
        afterEventSequence = startupBlockers[startupBlockers.length - 1]?.eventSequence;
        if (afterEventSequence === undefined) break;
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider delivery blocker auto-heal failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    const retryableDeliveries = yield* deliveryRepository.listRetryableDeliveries(
      PROVIDER_COMMAND_REACTOR_CONSUMER,
    );
    yield* deliveryGate.withSourceLock(
      Effect.forEach(retryableDeliveries, resumeRetryableDelivery, { discard: true }),
    );

    const processOrderedEventSerially = (event: OrchestrationEvent) =>
      deliveryGate.withSourceLock(processOrderedEvent(event));

    const replayThrough = yield* orchestrationEngine.getEventHighWaterSequence;
    yield* Stream.runForEach(
      orchestrationEngine.readEventsThrough(cursor, replayThrough),
      processOrderedEventSerially,
    );
    yield* Stream.runForEach(liveEvents, processOrderedEventSerially).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("provider command durable source stopped", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.andThen(Effect.failCause(cause))),
      ),
      Effect.forkScoped,
    );
  });
  return { startProviderIntentSource };
}
