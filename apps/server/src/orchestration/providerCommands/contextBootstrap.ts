import type { ServiceMap } from "effect";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderContextLifecycleActivityRecord,
  ProviderContextLifecycleActivityInput,
  recapTailPreview,
  providerContextLifecycleSummary,
  PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND,
} from "./contextLifecycle";
import { Queue, Effect, Cause, Stream, Duration } from "effect";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { CommandId, EventId, ThreadId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import { ProviderQueueDrainEvent } from "./deliveryClaims";
import { PendingInterruptEscalation, PendingContextBootstrapAttempt } from "./runtimeState";

export function makeProviderContextBootstrap(input: {
  readonly pendingInterruptEscalations: Map<string, PendingInterruptEscalation>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly pendingProviderContextLifecycleActivities: Map<
    string,
    ProviderContextLifecycleActivityRecord
  >;
  readonly queuedProviderContextLifecycleActivityRetries: Set<string>;
  readonly providerContextLifecycleActivityRetryQueue: Queue.Queue<string>;
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly pendingContextBootstrapAttempts: Map<string, PendingContextBootstrapAttempt>;
  readonly freshSessionContextBootstrapThreadIds: Set<string>;
}) {
  const {
    pendingInterruptEscalations,
    orchestrationEngine,
    pendingProviderContextLifecycleActivities,
    queuedProviderContextLifecycleActivityRetries,
    providerContextLifecycleActivityRetryQueue,
    providerService,
    pendingContextBootstrapAttempts,
    freshSessionContextBootstrapThreadIds,
  } = input;
  const completeInterruptEscalation = (
    threadId: string,
    escalation: PendingInterruptEscalation | undefined,
  ) => {
    if (escalation && pendingInterruptEscalations.get(threadId) === escalation) {
      pendingInterruptEscalations.delete(threadId);
    }
  };

  const providerContextLifecycleActivityKey = (
    input: Pick<ProviderContextLifecycleActivityRecord, "threadId" | "turnId">,
  ) => `${input.threadId}:${input.turnId}`;

  const toProviderContextLifecycleActivityRecord = (
    input: ProviderContextLifecycleActivityInput,
  ): ProviderContextLifecycleActivityRecord => {
    const recapCharacters = input.evidence.recapText?.length ?? 0;
    const recapPreview =
      input.evidence.recapText === null ? null : recapTailPreview(input.evidence.recapText);
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.provider,
      nativeHistory: input.evidence.nativeHistory,
      sessionRestarted: input.evidence.sessionRestarted,
      restartReason: input.evidence.reason,
      recapInjected: input.evidence.recapText !== null,
      recapCharacters,
      recapPreview,
      recapPreviewTruncated:
        input.evidence.recapText !== null &&
        input.evidence.recapText.trim().length > (recapPreview?.length ?? 0),
      summary: providerContextLifecycleSummary(input.evidence),
      createdAt: input.createdAt,
      completeDurablePriorTranscript: input.completeDurablePriorTranscript ?? false,
    };
  };

  const appendProviderContextLifecycleActivity = (
    input: ProviderContextLifecycleActivityRecord,
  ) => {
    const activityKey = providerContextLifecycleActivityKey(input);
    return orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: CommandId.makeUnsafe(`server:provider-context-lifecycle:${activityKey}`),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(`provider-context-lifecycle:${activityKey}`),
        tone: input.nativeHistory === "unavailable" ? "error" : "info",
        kind: PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND,
        summary: input.summary,
        payload: {
          provider: input.provider,
          nativeHistory: input.nativeHistory,
          sessionRestarted: input.sessionRestarted,
          restartReason: input.restartReason,
          recapInjected: input.recapInjected,
          recapCharacters: input.recapCharacters,
          recapPreview: input.recapPreview,
          recapPreviewTruncated: input.recapPreviewTruncated,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  };

  const scheduleProviderContextLifecycleActivityRetry = Effect.fnUntraced(function* (
    activityKey: string,
  ) {
    if (
      !pendingProviderContextLifecycleActivities.has(activityKey) ||
      queuedProviderContextLifecycleActivityRetries.has(activityKey)
    ) {
      return;
    }
    queuedProviderContextLifecycleActivityRetries.add(activityKey);
    yield* Queue.offer(providerContextLifecycleActivityRetryQueue, activityKey);
  });

  const retainAndAppendProviderContextLifecycleActivity = Effect.fnUntraced(function* (
    input: ProviderContextLifecycleActivityRecord,
    options: { readonly retryExisting?: boolean } = {},
  ) {
    const activityKey = providerContextLifecycleActivityKey(input);
    if (options.retryExisting === true) {
      if (pendingProviderContextLifecycleActivities.get(activityKey) !== input) {
        return "discarded" as const;
      }
    } else {
      pendingProviderContextLifecycleActivities.set(activityKey, input);
    }
    const activityAppended = yield* appendProviderContextLifecycleActivity(input).pipe(
      Effect.as(true),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : scheduleProviderContextLifecycleActivityRetry(activityKey)
              .pipe(
                Effect.andThen(
                  Effect.logWarning("queued provider context lifecycle activity for retry", {
                    threadId: input.threadId,
                    turnId: input.turnId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              )
              .pipe(Effect.as(false)),
      ),
    );

    if (pendingProviderContextLifecycleActivities.get(activityKey) !== input) {
      return "discarded" as const;
    }
    if (!activityAppended) {
      return "activity-pending" as const;
    }
    if (pendingProviderContextLifecycleActivities.get(activityKey) === input) {
      pendingProviderContextLifecycleActivities.delete(activityKey);
    }
    if (input.completeDurablePriorTranscript && providerService.completePriorTranscriptBootstrap) {
      return yield* providerService
        .completePriorTranscriptBootstrap({ threadId: input.threadId })
        .pipe(
          Effect.as("completed" as const),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning(
                  "provider context lifecycle activity could not retire transcript bootstrap",
                  {
                    threadId: input.threadId,
                    turnId: input.turnId,
                    cause: Cause.pretty(cause),
                  },
                ).pipe(Effect.as("durable-pending" as const)),
          ),
        );
    }
    return "completed" as const;
  });

  const runProviderContextLifecycleActivityRetries = Stream.fromQueue(
    providerContextLifecycleActivityRetryQueue,
  ).pipe(
    Stream.runForEach((activityKey) =>
      Effect.sleep(Duration.millis(250)).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            queuedProviderContextLifecycleActivityRetries.delete(activityKey);
            const pending = pendingProviderContextLifecycleActivities.get(activityKey);
            if (!pending) {
              return;
            }

            const persistence = yield* retainAndAppendProviderContextLifecycleActivity(pending, {
              retryExisting: true,
            });
            if (persistence === "completed") {
              const attempt = pendingContextBootstrapAttempts.get(pending.threadId);
              if (attempt?.turnId === pending.turnId) {
                retirePendingContextBootstrapAttempt(pending.threadId, attempt);
              }
            } else if (persistence === "durable-pending") {
              const attempt = pendingContextBootstrapAttempts.get(pending.threadId);
              if (attempt?.turnId === pending.turnId) {
                pendingContextBootstrapAttempts.delete(pending.threadId);
              }
            }
          }),
        ),
      ),
    ),
  );

  const clearPendingContextBootstraps = (threadId: string) => {
    freshSessionContextBootstrapThreadIds.delete(threadId);
    pendingContextBootstrapAttempts.delete(threadId);
  };

  const clearPendingContextBootstrapAttemptFlags = (
    threadId: string,
    attempt: PendingContextBootstrapAttempt,
  ) => {
    if (attempt.clearFreshSessionTranscript) {
      freshSessionContextBootstrapThreadIds.delete(threadId);
    }
  };

  const retirePendingContextBootstrapAttempt = (
    threadId: string,
    attempt: PendingContextBootstrapAttempt,
  ) => {
    if (pendingContextBootstrapAttempts.get(threadId) !== attempt) {
      return;
    }
    clearPendingContextBootstrapAttemptFlags(threadId, attempt);
    pendingContextBootstrapAttempts.delete(threadId);
  };

  const persistPriorTranscriptBootstrapCompletion = Effect.fnUntraced(function* (
    threadId: ThreadId,
    provider: ProviderKind,
  ) {
    if (!providerService.completePriorTranscriptBootstrap) {
      return false;
    }
    return yield* providerService.completePriorTranscriptBootstrap({ threadId }).pipe(
      Effect.as(true),
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor could not mark transcript bootstrap complete", {
          threadId,
          provider,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(false)),
      ),
    );
  });

  const completePendingContextBootstrapAttempt = Effect.fnUntraced(function* (
    threadId: ThreadId,
    attempt: PendingContextBootstrapAttempt,
    event: ProviderQueueDrainEvent,
  ) {
    if (event.type !== "turn.completed" || event.payload.state !== "completed") {
      return;
    }
    completeInterruptEscalation(threadId, attempt.interruptEscalation);

    let lifecyclePersistenceOwnsDurableBootstrap = false;
    if (attempt.lifecycleEvidence !== null && attempt.turnId !== undefined) {
      lifecyclePersistenceOwnsDurableBootstrap = true;
      const lifecyclePersistence = yield* retainAndAppendProviderContextLifecycleActivity(
        toProviderContextLifecycleActivityRecord({
          threadId,
          turnId: attempt.turnId,
          provider: event.provider,
          evidence: attempt.lifecycleEvidence,
          createdAt: attempt.lifecycleEvidenceCreatedAt,
          completeDurablePriorTranscript: attempt.completeDurablePriorTranscript,
        }),
      );
      if (lifecyclePersistence === "activity-pending") {
        clearPendingContextBootstrapAttemptFlags(threadId, attempt);
        return;
      }
      if (lifecyclePersistence === "durable-pending") {
        return;
      }
    }
    if (pendingContextBootstrapAttempts.get(threadId) !== attempt) {
      return;
    }
    if (
      attempt.completeDurablePriorTranscript &&
      !lifecyclePersistenceOwnsDurableBootstrap &&
      providerService.completePriorTranscriptBootstrap
    ) {
      const completed = yield* persistPriorTranscriptBootstrapCompletion(threadId, event.provider);
      if (!completed) {
        return;
      }
    }
    if (pendingContextBootstrapAttempts.get(threadId) !== attempt) {
      return;
    }
    retirePendingContextBootstrapAttempt(threadId, attempt);
  });

  const observePendingContextBootstrapTerminalEvent = Effect.fnUntraced(function* (
    event: ProviderQueueDrainEvent,
  ) {
    const attempt = pendingContextBootstrapAttempts.get(event.threadId);
    if (!attempt) {
      return;
    }
    if (attempt.turnId === undefined) {
      attempt.terminalEvent = event;
      return;
    }
    if (attempt.turnId !== event.turnId) {
      return;
    }
    if (event.type !== "turn.completed" || event.payload.state !== "completed") {
      if (pendingContextBootstrapAttempts.get(event.threadId) === attempt) {
        pendingContextBootstrapAttempts.delete(event.threadId);
      }
      return;
    }
    yield* completePendingContextBootstrapAttempt(event.threadId, attempt, event);
  });
  return {
    clearPendingContextBootstraps,
    completeInterruptEscalation,
    completePendingContextBootstrapAttempt,
    retainAndAppendProviderContextLifecycleActivity,
    toProviderContextLifecycleActivityRecord,
    persistPriorTranscriptBootstrapCompletion,
    observePendingContextBootstrapTerminalEvent,
    runProviderContextLifecycleActivityRetries,
  };
}
