import type { ServiceMap } from "effect";
import {
  ProviderRuntimeEventRepository,
  PROVIDER_RUNTIME_INGESTION_CONSUMER,
} from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ThreadId, TurnId, CommandId } from "@glade/contracts/core/baseSchemas";
import { makeProviderThreadProjection } from "./threadProjection";
import { Ref, Effect, Stream, Option, Scope, Duration, Cause, Exit, Schema } from "effect";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";
import { ProviderQueueDrainEvent } from "./deliveryClaims";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { type PendingClaudeCacheReview } from "@glade/contracts/orchestration/threadEntities";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { ProviderAdapterValidationError } from "../../provider/core/Errors.ts";
import { sameClaudeCacheContext, LOST_CLAUDE_COMPACTION_ERROR } from "./contextLifecycle";
import { classifyProviderAttemptOutcome, providerFailureMessage } from "./providerCallPolicy";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { makeProviderQueuedTurns } from "./queuedTurns";
import { makeProviderDeliveryAccess } from "./deliveryAccess";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { makeProviderTurnStart } from "./turnStart";

export function makeProviderCompaction(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly runtimeEventRepository: ServiceMap.Service.Shape<typeof ProviderRuntimeEventRepository>;
  readonly readOrchestrationEventAtSequence: ReturnType<
    typeof makeProviderQueuedTurns
  >["readOrchestrationEventAtSequence"];
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly deliveryRepository: ServiceMap.Service.Shape<
    typeof OrchestrationEventDeliveryRepository
  >;
  readonly pendingClaudeCompactionIngestion: Set<ThreadId>;
  readonly setClaudeCacheReview: ReturnType<
    typeof makeProviderThreadProjection
  >["setClaudeCacheReview"];
  readonly deliveryGate: ServiceMap.Service.Shape<typeof ProviderDeliveryGate>;
  readonly earlyClaudeCompactionTerminals: Map<ThreadId, ProviderQueueDrainEvent>;
  readonly reconcileDelivery: ReturnType<typeof makeProviderDeliveryAccess>["reconcileDelivery"];
  readonly drainQueuedTurnsForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["drainQueuedTurnsForSession"];
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly pendingInteractions: ServiceMap.Service.Shape<
    typeof ProjectionPendingInteractionRepository
  >;
  readonly ensureSessionForThread: ReturnType<
    typeof makeProviderSessionConfiguration
  >["ensureSessionForThread"];
  readonly isClaudeReviewAuthorized: ReturnType<
    typeof makeProviderThreadProjection
  >["isClaudeReviewAuthorized"];
  readonly recoveringClaudeCompactions: Ref.Ref<boolean>;
  readonly startupClaudeCompactionTurns: Set<TurnId>;
  readonly processTurnStartRequestedWithoutLease: ReturnType<
    typeof makeProviderTurnStart
  >["processTurnStartRequestedWithoutLease"];
}) {
  const {
    runtimeEventRepository,
    readOrchestrationEventAtSequence,
    orchestrationEngine,
    deliveryRepository,
    pendingClaudeCompactionIngestion,
    setClaudeCacheReview,
    deliveryGate,
    earlyClaudeCompactionTerminals,
    reconcileDelivery,
    drainQueuedTurnsForSession,
    providerService,
    pendingInteractions,
    ensureSessionForThread,
    isClaudeReviewAuthorized,
    recoveringClaudeCompactions,
    startupClaudeCompactionTurns,
    processTurnStartRequestedWithoutLease,
    projectionAccess,
  } = input;
  const {
    resolveThread,
    withProviderSessionLease,
    hasLiveProviderTurn,
    resolveLiveProviderTurnId,
  } = projectionAccess;
  const readClaudeCompactionTerminal = Effect.fnUntraced(function* (
    threadId: ThreadId,
    turnId: TurnId,
  ) {
    const highWater = yield* runtimeEventRepository.getHighWaterSequence;
    const events = yield* runtimeEventRepository.readThreadEvents({
      threadId,
      turnId,
      throughSequenceInclusive: highWater,
      limit: 1,
      eventTypes: ["turn.completed", "turn.aborted"],
    });
    const event = events[0]?.event;
    return event?.type === "turn.completed" || event?.type === "turn.aborted" ? event : undefined;
  });

  const readClaudeCompactionAttempt = Effect.fnUntraced(function* (
    threadId: ThreadId,
    responseEventSequence: number,
  ) {
    const response = yield* readOrchestrationEventAtSequence(responseEventSequence);
    if (
      response?.type !== "thread.claude-cache-response-requested" ||
      response.payload.threadId !== threadId ||
      response.payload.decision !== "compact"
    )
      return undefined;
    const highWater = yield* orchestrationEngine.getEventHighWaterSequence;
    return yield* orchestrationEngine
      .readThreadEventsThrough(threadId, responseEventSequence, highWater, [
        "thread.claude-cache-set",
      ])
      .pipe(
        Stream.runFold(
          () => undefined as PendingClaudeCacheReview | undefined,
          (attempt, event) => {
            if (event.type !== "thread.claude-cache-set") return attempt;
            const review = event.payload.review;
            return review?.reviewId === response.payload.review.reviewId &&
              review.compactionResponseEventSequence === responseEventSequence &&
              review.compactionTurnId
              ? review
              : attempt;
          },
        ),
      );
  });

  const readBlockedClaudeCompactionAttempt = Effect.fnUntraced(function* (threadId: ThreadId) {
    const blocker = yield* deliveryRepository.firstBlockingDeliveryForThread({
      consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
      threadId,
    });
    return Option.isSome(blocker)
      ? yield* readClaudeCompactionAttempt(threadId, blocker.value.eventSequence)
      : undefined;
  });

  const processClaudeCompactionTerminal: (
    event: ProviderQueueDrainEvent,
  ) => Effect.Effect<void, TaggedFailure, Scope.Scope> = Effect.fnUntraced(function* (
    event: ProviderQueueDrainEvent,
  ) {
    if (event.provider !== "claudeAgent") return;
    const thread = yield* resolveThread(event.threadId);
    let review = thread?.claudeCacheReview;
    const attempt =
      review?.compactionTurnId === event.turnId
        ? review
        : yield* readBlockedClaudeCompactionAttempt(event.threadId);
    if (!attempt?.compactionTurnId || attempt.compactionTurnId !== event.turnId) return;
    const journalHighWater = yield* runtimeEventRepository.getHighWaterSequence;
    const journalEvents = yield* runtimeEventRepository.readThreadEvents({
      threadId: event.threadId,
      turnId: attempt.compactionTurnId,
      throughSequenceInclusive: journalHighWater,
      limit: 1,
      eventTypes: ["turn.completed", "turn.aborted"],
    });
    const terminalSequence = journalEvents[0]?.sequence;

    if (
      terminalSequence !== undefined &&
      (yield* runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER)) <
        terminalSequence
    ) {
      // The raw provider subscriber can run ahead of transcript ingestion. A pending user row must not be
      // restored while old control-turn events can still consume it.
      if (!pendingClaudeCompactionIngestion.has(event.threadId)) {
        pendingClaudeCompactionIngestion.add(event.threadId);
        yield* Effect.gen(function* () {
          while (
            (yield* runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER)) <
            terminalSequence
          ) {
            yield* Effect.sleep(Duration.millis(50));
          }
          yield* processClaudeCompactionTerminal(event);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => pendingClaudeCompactionIngestion.delete(event.threadId)),
          ),
          Effect.tapCause((cause) =>
            Effect.gen(function* () {
              // Shutdown must preserve durable recovery; a failed terminal release must not leave an unclickable
              // in-progress review.
              if (Cause.hasInterruptsOnly(cause)) return;
              yield* Effect.logError("Could not await Claude compaction ingestion", {
                cause: Cause.pretty(cause),
              });
              const current = (yield* resolveThread(event.threadId))?.claudeCacheReview;
              if (
                current?.reviewId === attempt.reviewId &&
                current.compactionTurnId === event.turnId &&
                (current.status === "compacting" || current.status === "uncertain")
              ) {
                yield* setClaudeCacheReview(
                  event.threadId,
                  {
                    ...current,
                    status: "failed",
                    error:
                      "Compaction finished, but its result could not be applied. Review the saved message before continuing.",
                  },
                  current.reviewId,
                );
              }
            }),
          ),
          Effect.forkScoped,
        );
      }
      return;
    }
    if (attempt.compactionResponseEventSequence !== undefined && deliveryGate.getReconciler()) {
      const delivery = yield* deliveryRepository.getDelivery({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: attempt.compactionResponseEventSequence,
      });
      if (Option.isSome(delivery) && delivery.value.state === "inflight") {
        earlyClaudeCompactionTerminals.set(event.threadId, event);
        return;
      }
      if (
        Option.isSome(delivery) &&
        (delivery.value.state === "uncertain" || delivery.value.state === "dead")
      ) {
        yield* reconcileDelivery({
          threadId: event.threadId,
          eventSequence: attempt.compactionResponseEventSequence,
          expectedState: delivery.value.state,
          outcome: "accepted",
          reconciledBy: "claude-compaction-terminal",
          note: "The matching native compaction terminal event confirms that the operation was accepted.",
        });
      }
    }
    // A terminal settles delivery, but never restores revoked send consent.
    review = (yield* resolveThread(event.threadId))?.claudeCacheReview;
    if (
      !review ||
      review.reviewId !== attempt.reviewId ||
      review.compactionTurnId !== event.turnId ||
      (review.status !== "compacting" && review.status !== "uncertain")
    )
      return;
    if (
      event.type !== "turn.completed" ||
      event.payload.state !== "completed" ||
      event.payload.contextCompacted !== true ||
      thread?.archivedAt != null ||
      thread?.deletedAt != null
    ) {
      yield* setClaudeCacheReview(
        event.threadId,
        {
          ...review,
          status: "failed",
          error:
            "Native compaction did not complete with a confirmed context boundary. The saved message was not sent.",
        },
        review.reviewId,
      );
      return;
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.claude-cache.compacted",
        commandId: CommandId.makeUnsafe(
          `server:claude-cache-compacted:${review.reviewId}:${event.turnId}`,
        ),
        threadId: event.threadId,
        reviewId: review.reviewId,
        turnId: attempt.compactionTurnId!,
        createdAt: event.createdAt,
      })
      .pipe(
        Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
          Effect.gen(function* () {
            if (error.detail === "Command produced no events.") return;
            const current = (yield* resolveThread(event.threadId))?.claudeCacheReview;
            if (
              current?.reviewId === review.reviewId &&
              current.compactionTurnId === event.turnId &&
              (current.status === "compacting" || current.status === "uncertain")
            ) {
              yield* setClaudeCacheReview(
                event.threadId,
                { ...current, status: "failed", error: error.detail },
                current.reviewId,
              );
            }
            return yield* Effect.fail(error);
          }),
        ),
      );
  });

  const processClaudeCacheResponse = (
    event: Extract<ProviderIntentEvent, { type: "thread.claude-cache-response-requested" }>,
  ) =>
    withProviderSessionLease(
      event.payload.threadId,
      Effect.gen(function* () {
        const { threadId, review, decision } = event.payload;
        const thread = yield* resolveThread(threadId);
        if (
          !thread ||
          thread.deletedAt != null ||
          thread.claudeCacheReview?.reviewId !== review.reviewId ||
          thread.claudeCacheReview.status !== "responding"
        )
          return;
        if (thread.archivedAt != null) {
          yield* setClaudeCacheReview(
            threadId,
            {
              ...review,
              status: "failed",
              error: "This task is unavailable. The saved message was not sent.",
            },
            review.reviewId,
          );
          return;
        }
        if (decision === "cancel") {
          yield* setClaudeCacheReview(threadId, null, review.reviewId);
          yield* drainQueuedTurnsForSession(threadId);
          return;
        }
        const source = yield* readOrchestrationEventAtSequence(review.sourceEventSequence);
        if (
          !source ||
          source.type !== "thread.turn-start-requested" ||
          source.payload.threadId !== threadId ||
          source.payload.messageId !== review.messageId ||
          (yield* hasLiveProviderTurn(threadId))
        ) {
          yield* setClaudeCacheReview(
            threadId,
            {
              ...review,
              status: "failed",
              error: "The saved message is unavailable or Claude is busy. Nothing was sent.",
            },
            review.reviewId,
          );
          return;
        }
        if (decision === "compact") {
          const message = thread.messages.find((entry) => entry.id === review.messageId);
          const busyTasks = providerService.hasLiveRuntimeTasks
            ? yield* providerService.hasLiveRuntimeTasks({ threadId })
            : false;
          const pending = yield* pendingInteractions.getPendingCountsByThreadId({ threadId });
          if (
            !providerService.startClaudeCompaction ||
            !message ||
            /^\/compact(?:\s|$)/.test(message.text.trim()) ||
            busyTasks ||
            pending.pendingApprovalCount > 0 ||
            pending.pendingUserInputCount > 0
          ) {
            yield* setClaudeCacheReview(
              threadId,
              {
                ...review,
                status: "failed",
                error:
                  "Native compaction is unavailable or Claude still has active work. The saved message was not sent.",
              },
              review.reviewId,
            );
            return;
          }
          yield* ensureSessionForThread(threadId, event.payload.createdAt, {
            ...(source.payload.modelSelection
              ? { modelSelection: source.payload.modelSelection }
              : {}),
            ...(source.payload.providerOptions
              ? { providerOptions: source.payload.providerOptions }
              : {}),
            runtimeMode: source.payload.runtimeMode,
          });
          const observation = providerService.getClaudeCacheObservation
            ? yield* providerService.getClaudeCacheObservation(threadId)
            : undefined;
          if (!(yield* isClaudeReviewAuthorized(threadId, review.reviewId, "responding"))) {
            return yield* new ProviderAdapterValidationError({
              provider: "claudeAgent",
              operation: "thread.claude-cache.compact",
              issue: "The saved message is no longer available for compaction.",
            });
          }
          if (!observation || !sameClaudeCacheContext(review.assessment, observation)) {
            yield* setClaudeCacheReview(
              threadId,
              {
                ...review,
                reviewId: `claude-cache:${source.eventId}:${crypto.randomUUID()}`,
                ...(observation ? { assessment: observation } : {}),
                status: "pending",
                error: "Claude's context changed. Review it before compacting.",
              },
              review.reviewId,
            );
            return;
          }
          const turnId = TurnId.makeUnsafe(crypto.randomUUID());
          const compactingReview: PendingClaudeCacheReview = {
            ...review,
            status: "compacting",
            compactionTurnId: turnId,
            compactionResponseEventSequence: event.sequence,
            requestedAt: source.payload.createdAt,
            ...(source.payload.sourceProposedPlan
              ? { sourceProposedPlan: source.payload.sourceProposedPlan }
              : {}),
          };
          yield* setClaudeCacheReview(threadId, compactingReview, review.reviewId);
          if (!(yield* isClaudeReviewAuthorized(threadId, review.reviewId, "compacting"))) {
            return yield* new ProviderAdapterValidationError({
              provider: "claudeAgent",
              operation: "thread.claude-cache.compact",
              issue: "The saved message is no longer available for compaction.",
            });
          }
          yield* providerService.startClaudeCompaction({ threadId, turnId }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (Ref.getUnsafe(recoveringClaudeCompactions))
                  startupClaudeCompactionTurns.add(turnId);
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                const rejected =
                  classifyProviderAttemptOutcome(Exit.failCause(cause))._tag === "rejected";
                yield* setClaudeCacheReview(
                  threadId,
                  {
                    ...compactingReview,
                    status: rejected ? "failed" : "uncertain",
                    error: `Compaction could not be confirmed. ${providerFailureMessage(cause)}`,
                  },
                  review.reviewId,
                );
                if (!rejected) return yield* Effect.die(new Error(Cause.pretty(cause)));
              }),
            ),
          );
          return;
        }
        yield* processTurnStartRequestedWithoutLease(source, review, event.sequence).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const outcome = classifyProviderAttemptOutcome(Exit.failCause(cause));
              const rejected = outcome._tag === "rejected";
              yield* setClaudeCacheReview(
                threadId,
                {
                  ...review,
                  status: rejected ? "failed" : "uncertain",
                  error: rejected
                    ? providerFailureMessage(cause)
                    : `The send could not be confirmed and was not retried. ${providerFailureMessage(cause)}`,
                },
                review.reviewId,
              );
              if (!rejected) return yield* Effect.die(new Error(Cause.pretty(cause)));
            }),
          ),
        );
        const remaining = (yield* resolveThread(threadId))?.claudeCacheReview;
        if (remaining?.reviewId === review.reviewId && remaining.status === "responding") {
          yield* setClaudeCacheReview(
            threadId,
            {
              ...review,
              status: "failed",
              error: "The saved send could not start. Review the message and try again.",
            },
            review.reviewId,
          );
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const review = (yield* resolveThread(event.payload.threadId))?.claudeCacheReview;
            const rejected =
              classifyProviderAttemptOutcome(Exit.failCause(cause))._tag === "rejected";
            if (
              review?.reviewId === event.payload.review.reviewId &&
              (review.status === "responding" || (review.status === "compacting" && rejected))
            ) {
              yield* setClaudeCacheReview(
                event.payload.threadId,
                {
                  ...review,
                  status: rejected ? "failed" : "uncertain",
                  error: providerFailureMessage(cause),
                },
                review.reviewId,
              );
            }
            return yield* Effect.failCause(cause);
          }),
        ),
      ),
    );

  const recoverClaudeCompactions = Effect.gen(function* () {
    const snapshot = yield* orchestrationEngine.getReadModel();
    for (const thread of snapshot.threads) {
      const review =
        thread.claudeCacheReview ?? (yield* readBlockedClaudeCompactionAttempt(thread.id));
      if (
        !review?.compactionTurnId ||
        (review.status !== "compacting" &&
          review.status !== "uncertain" &&
          review.status !== "failed")
      )
        continue;
      const terminal = yield* readClaudeCompactionTerminal(thread.id, review.compactionTurnId);
      if (terminal && review.status !== "failed") {
        yield* processClaudeCompactionTerminal(terminal).pipe(
          Effect.catchCause((cause) => {
            const failure = Cause.findErrorOption(cause);

            if (
              cause.reasons.length !== 1 ||
              Option.isNone(failure) ||
              !Schema.is(OrchestrationCommandInvariantError)(failure.value)
            )
              return Effect.failCause(cause);
            return Effect.logError("Could not recover Claude compaction for task", {
              threadId: thread.id,
              cause: Cause.pretty(cause),
            });
          }),
        );
        continue;
      }
      // Its current runtime still owns the operation; wait for that terminal event. A turn accepted by
      // this startup is not abandoned merely because the adapter has settled its live state before
      // journaling the terminal.
      if (
        startupClaudeCompactionTurns.has(review.compactionTurnId) ||
        (yield* resolveLiveProviderTurnId(thread.id)) === review.compactionTurnId
      )
        continue;
      if (review.compactionResponseEventSequence !== undefined && deliveryGate.getReconciler()) {
        const delivery = yield* deliveryRepository.getDelivery({
          consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
          eventSequence: review.compactionResponseEventSequence,
        });
        if (
          Option.isSome(delivery) &&
          (delivery.value.state === "uncertain" || delivery.value.state === "dead")
        ) {
          const response = yield* readOrchestrationEventAtSequence(
            review.compactionResponseEventSequence,
          );
          if (
            response?.type === "thread.claude-cache-response-requested" &&
            response.payload.threadId === thread.id &&
            response.payload.review.reviewId === review.reviewId &&
            response.payload.decision === "compact"
          ) {
            yield* reconcileDelivery({
              threadId: thread.id,
              eventSequence: review.compactionResponseEventSequence,
              expectedState: delivery.value.state,
              outcome: "abandon",
              reconciledBy: "claude-compaction-recovery",
              note: LOST_CLAUDE_COMPACTION_ERROR,
            });
            continue;
          }
        }
      }

      if (review.status === "compacting") {
        yield* setClaudeCacheReview(
          thread.id,
          {
            ...review,
            status: "failed",
            error: LOST_CLAUDE_COMPACTION_ERROR,
          },
          review.reviewId,
        );
      }
    }
  });
  return {
    processClaudeCompactionTerminal,
    processClaudeCacheResponse,
    readClaudeCompactionTerminal,
    readClaudeCompactionAttempt,
    recoverClaudeCompactions,
  };
}
