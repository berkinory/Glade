import type { ServiceMap } from "effect";
import { Queue, Effect, Cause, Stream, Duration } from "effect";
import { ThreadId, MessageId } from "@glade/contracts/core/baseSchemas";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { activeThreadGoal, buildGoalContinuationInput } from "../../provider/core/goalMode.ts";
import { serverCommandId } from "./deliveryClaims";
import { deriveTurnStartSession } from "../turnStartSession.ts";
import { providerFailureMessage } from "./providerCallPolicy";
import { BlockedGoalContinuation } from "./runtimeState";
import { makeProviderQueuedTurns } from "./queuedTurns";
import { makeProviderTurnDispatch } from "./turnDispatch";
import { makeProviderTaskControl } from "./taskControl";

export function makeProviderGoalContinuation(input: {
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly queuedGoalContinuationRetries: Set<string>;
  readonly goalContinuationRetryQueue: Queue.Queue<ThreadId>;
  readonly blockedGoalContinuations: Map<string, BlockedGoalContinuation>;
  readonly pendingInteractions: ServiceMap.Service.Shape<
    typeof ProjectionPendingInteractionRepository
  >;
  readonly drainQueuedTurnsForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["drainQueuedTurnsForSession"];
  readonly hasPendingQueuedTurnForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["hasPendingQueuedTurnForSession"];
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
  readonly dispatchTurnForThread: ReturnType<
    typeof makeProviderTurnDispatch
  >["dispatchTurnForThread"];
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly setThreadSessionError: ReturnType<
    typeof makeProviderThreadProjection
  >["setThreadSessionError"];
  readonly pauseActiveThreadGoal: ReturnType<
    typeof makeProviderThreadProjection
  >["pauseActiveThreadGoal"];
  readonly interruptProviderTurn: ReturnType<
    typeof makeProviderTaskControl
  >["interruptProviderTurn"];
}) {
  const {
    queuedGoalContinuationRetries,
    goalContinuationRetryQueue,
    blockedGoalContinuations,
    pendingInteractions,
    drainQueuedTurnsForSession,
    hasPendingQueuedTurnForSession,
    orchestrationEngine,
    setThreadSession,
    dispatchTurnForThread,
    appendProviderFailureActivity,
    setThreadSessionError,
    pauseActiveThreadGoal,
    interruptProviderTurn,
    projectionAccess,
  } = input;
  const { resolveThread, hasLiveProviderTurn, withProviderSessionLease } = projectionAccess;
  const scheduleBlockedGoalContinuationRetry = Effect.fnUntraced(function* (threadId: ThreadId) {
    if (queuedGoalContinuationRetries.has(threadId)) {
      return;
    }
    queuedGoalContinuationRetries.add(threadId);
    yield* Queue.offer(goalContinuationRetryQueue, threadId);
  });

  const deferGoalContinuation = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.goal-continuation-requested" }>,
  ) {
    blockedGoalContinuations.set(event.payload.threadId, {
      goalStartedAt: event.payload.goalStartedAt,
      trigger: event.payload.trigger,
      ...(event.payload.sourceTurnId !== undefined
        ? { sourceTurnId: event.payload.sourceTurnId }
        : {}),
    });
    yield* scheduleBlockedGoalContinuationRetry(event.payload.threadId);
  });

  const retryBlockedGoalContinuation = Effect.fnUntraced(function* (threadId: ThreadId) {
    const pending = blockedGoalContinuations.get(threadId);
    if (!pending) {
      return;
    }

    const thread = yield* resolveThread(threadId);
    if (
      !thread ||
      thread.deletedAt != null ||
      thread.archivedAt != null ||
      thread.parentThreadId != null ||
      thread.interactionMode === "plan" ||
      !activeThreadGoal(thread)?.trim() ||
      thread.goalPausedAt != null ||
      (thread.goalStartedAt ?? null) !== pending.goalStartedAt
    ) {
      blockedGoalContinuations.delete(threadId);
      return;
    }

    const pendingInteractionCounts = yield* pendingInteractions.getPendingCountsByThreadId({
      threadId,
    });
    if (
      pendingInteractionCounts.pendingApprovalCount > 0 ||
      pendingInteractionCounts.pendingUserInputCount > 0 ||
      thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      (yield* hasLiveProviderTurn(threadId))
    ) {
      yield* scheduleBlockedGoalContinuationRetry(threadId);
      return;
    }

    yield* drainQueuedTurnsForSession(threadId);
    if (yield* hasPendingQueuedTurnForSession(threadId)) {
      yield* scheduleBlockedGoalContinuationRetry(threadId);
      return;
    }

    if (blockedGoalContinuations.get(threadId) !== pending) {
      return;
    }
    blockedGoalContinuations.delete(threadId);
    yield* orchestrationEngine
      .dispatch({
        type: "thread.goal.continue",
        commandId: serverCommandId("goal-blocker-cleared"),
        threadId,
        goalStartedAt: pending.goalStartedAt,
        trigger: pending.trigger,
        ...(pending.sourceTurnId !== undefined ? { sourceTurnId: pending.sourceTurnId } : {}),
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => {
                if (!blockedGoalContinuations.has(threadId)) {
                  blockedGoalContinuations.set(threadId, pending);
                }
              }).pipe(
                Effect.andThen(scheduleBlockedGoalContinuationRetry(threadId)),
                Effect.andThen(
                  Effect.logWarning("provider command reactor failed to retry goal continuation", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
        ),
      );
  });

  const runBlockedGoalContinuationRetries = Stream.fromQueue(goalContinuationRetryQueue).pipe(
    Stream.runForEach((threadId) =>
      Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            queuedGoalContinuationRetries.delete(threadId);
          }),
        ),
        Effect.andThen(retryBlockedGoalContinuation(threadId)),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : scheduleBlockedGoalContinuationRetry(threadId).pipe(
                Effect.andThen(
                  Effect.logWarning("provider command reactor goal continuation retry failed", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
        ),
      ),
    ),
  );

  const processGoalContinuationRequested = (
    event: Extract<ProviderIntentEvent, { type: "thread.goal-continuation-requested" }>,
  ) =>
    withProviderSessionLease(
      event.payload.threadId,
      Effect.gen(function* () {
        const thread = yield* resolveThread(event.payload.threadId);
        if (
          !thread ||
          thread.deletedAt != null ||
          thread.archivedAt != null ||
          thread.parentThreadId != null ||
          thread.interactionMode === "plan" ||
          !activeThreadGoal(thread)?.trim() ||
          thread.goalPausedAt != null ||
          thread.claudeCacheReview != null ||
          (thread.goalStartedAt ?? null) !== event.payload.goalStartedAt
        ) {
          blockedGoalContinuations.delete(event.payload.threadId);
          return;
        }

        const pendingInteractionCounts = yield* pendingInteractions.getPendingCountsByThreadId({
          threadId: thread.id,
        });
        if (
          pendingInteractionCounts.pendingApprovalCount > 0 ||
          pendingInteractionCounts.pendingUserInputCount > 0 ||
          (yield* hasLiveProviderTurn(thread.id))
        ) {
          yield* deferGoalContinuation(event);
          return;
        }

        yield* drainQueuedTurnsForSession(thread.id);
        if (yield* hasPendingQueuedTurnForSession(thread.id)) {
          yield* deferGoalContinuation(event);
          return;
        }

        blockedGoalContinuations.delete(thread.id);

        const createdAt = event.payload.createdAt;
        const providerName = thread.session?.providerName ?? thread.modelSelection.provider;
        const turnStartSession = deriveTurnStartSession({
          threadId: thread.id,
          currentSession: thread.session,
          providerName,
          requestedRuntimeMode: thread.runtimeMode,
          requestedAt: createdAt,
        });
        if (turnStartSession !== null) {
          yield* setThreadSession({
            threadId: thread.id,
            session: turnStartSession,
            createdAt,
          });
        }

        const startedTurn = yield* dispatchTurnForThread({
          threadId: thread.id,
          sourceEventSequence: event.sequence,
          messageId: MessageId.makeUnsafe(`goal-continuation:${event.eventId}`),
          messageText: buildGoalContinuationInput(),
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          dispatchMode: "queue",
          turnKind: "goal-continuation",
          createdAt,
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.gen(function* () {
                  const detail = Cause.pretty(cause);
                  yield* appendProviderFailureActivity({
                    threadId: thread.id,
                    kind: "provider.turn.start.failed",
                    summary: "Goal continuation failed",
                    detail,
                    turnId: null,
                    createdAt,
                  });
                  yield* setThreadSessionError({
                    threadId: thread.id,
                    runtimeMode: thread.runtimeMode,
                    detail: providerFailureMessage(cause),
                    createdAt,
                  });
                  yield* pauseActiveThreadGoal({
                    threadId: thread.id,
                    expectedGoalStartedAt: event.payload.goalStartedAt,
                  });
                }),
          ),
        );
        const latestThread = (yield* orchestrationEngine.getReadModel()).threads.find(
          (candidate) => candidate.id === thread.id,
        );
        // Stop/pause can commit while provider dispatch is awaiting acceptance. Fence the accepted turn
        // against the authoritative command model so it cannot escape the interrupt event that raced it
        // with a stale turn id.
        if (
          startedTurn &&
          (!latestThread ||
            latestThread.goalPausedAt != null ||
            !activeThreadGoal(latestThread)?.trim() ||
            (latestThread.goalStartedAt ?? null) !== event.payload.goalStartedAt)
        ) {
          yield* interruptProviderTurn({
            threadId: thread.id,
            turnId: startedTurn.turnId,
            createdAt: new Date().toISOString(),
          });
        }
      }),
    );

  const recoverActiveThreadGoals = Effect.gen(function* () {
    const snapshot = yield* orchestrationEngine.getReadModel();
    yield* Effect.forEach(
      snapshot.threads.filter(
        (thread) =>
          thread.deletedAt == null &&
          thread.archivedAt == null &&
          thread.parentThreadId == null &&
          Boolean(activeThreadGoal(thread)?.trim()) &&
          thread.goalPausedAt == null,
      ),
      (thread) =>
        orchestrationEngine.dispatch({
          type: "thread.goal.continue",
          commandId: serverCommandId("goal-startup-recovery"),
          threadId: thread.id,
          goalStartedAt: thread.goalStartedAt ?? null,
          trigger: "startup-recovery",
          createdAt: new Date().toISOString(),
        }),
      { discard: true },
    );
  });
  return {
    processGoalContinuationRequested,
    recoverActiveThreadGoals,
    runBlockedGoalContinuationRetries,
  };
}
