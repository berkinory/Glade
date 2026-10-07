import { HandoffTransitions } from "../Services/HandoffTransitions";
import type { MaybeGenerateThreadTitle } from "./threadTitleGeneration";
import type { ServiceMap } from "effect";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { makeProviderThreadProjection } from "./threadProjection";
import { Option, Effect, Cause, Schema, Exit } from "effect";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ServerConfig } from "../../server/config.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { TurnId, ProviderKind, CommandId } from "@glade/contracts/core/baseSchemas";
import { turnStartKeyForEvent } from "./deliveryClaims";
import { providerSupportsNativeTurnSteering } from "@glade/shared/provider/providerMetadata";
import { deriveTurnStartSession } from "../turnStartSession.ts";
import { DEFAULT_RUNTIME_MODE } from "./contextLifecycle";
import { resolveProviderDispatchAttachments } from "../../provider/core/providerAttachmentPaths.ts";
import {
  ProviderAdapterValidationError,
  ProviderValidationError,
} from "../../provider/core/Errors.ts";
import { providerFailureMessage } from "./providerCallPolicy";
import {
  QueuedDispatchState,
  type QueuedDispatchReservation,
} from "../Services/QueuedDispatchState.ts";
import { makeProviderQueuedTurns } from "./queuedTurns";
import { makeProviderTaskControl } from "./taskControl";
import { makeProviderConversationNaming } from "./conversationNaming";
import { makeProviderTurnDispatch } from "./turnDispatch";

export function makeProviderTurnStart(input: {
  readonly handoffTransitions: Option.Option<ServiceMap.Service.Shape<typeof HandoffTransitions>>;
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly queuedDispatchState: ServiceMap.Service.Shape<typeof QueuedDispatchState>;
  readonly drainQueuedTurnsForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["drainQueuedTurnsForSession"];
  readonly hasQueuedTurnStart: ReturnType<typeof makeProviderQueuedTurns>["hasQueuedTurnStart"];
  readonly hasHandledTurnStartRecently: ReturnType<
    typeof makeProviderQueuedTurns
  >["hasHandledTurnStartRecently"];
  readonly enqueueQueuedTurnStart: ReturnType<
    typeof makeProviderQueuedTurns
  >["enqueueQueuedTurnStart"];
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly threadSessionSettings: ServiceMap.Service.Shape<typeof ThreadSessionSettings>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly interruptProviderTurn: ReturnType<
    typeof makeProviderTaskControl
  >["interruptProviderTurn"];
  readonly setThreadSession: ReturnType<typeof makeProviderThreadProjection>["setThreadSession"];
  readonly serverConfig: ServiceMap.Service.Shape<typeof ServerConfig>;
  readonly managedAttachments: ServiceMap.Service.Shape<typeof ManagedAttachmentRepository>;
  readonly maybeGenerateAndRenameWorktreeBranchForFirstTurn: ReturnType<
    typeof makeProviderConversationNaming
  >["maybeGenerateAndRenameWorktreeBranchForFirstTurn"];
  readonly maybeGenerateThreadTitle: MaybeGenerateThreadTitle;
  readonly dispatchTurnForThread: ReturnType<
    typeof makeProviderTurnDispatch
  >["dispatchTurnForThread"];
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly setThreadSessionError: ReturnType<
    typeof makeProviderThreadProjection
  >["setThreadSessionError"];
}) {
  const {
    handoffTransitions,
    queuedDispatchState,
    drainQueuedTurnsForSession,
    hasQueuedTurnStart,
    hasHandledTurnStartRecently,
    enqueueQueuedTurnStart,
    appendProviderFailureActivity,
    threadSessionSettings,
    orchestrationEngine,
    interruptProviderTurn,
    setThreadSession,
    serverConfig,
    managedAttachments,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
    maybeGenerateThreadTitle,
    dispatchTurnForThread,
    providerService,
    setThreadSessionError,
    projectionAccess,
  } = input;
  const {
    resolveProviderSessionThread,
    resolveLiveProviderTurnId,
    resolveThread,
    withProviderSessionLease,
  } = projectionAccess;
  const processTurnStartRequestedWithoutLease = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
    deliveryEventSequence?: number,
  ) {
    const sessionThreadId =
      (yield* resolveProviderSessionThread(event.payload.threadId))?.id ?? event.payload.threadId;
    const matchesEvent = (entry: QueuedDispatchReservation | undefined) =>
      entry?.queuedThreadId === (event.payload.threadId as string) &&
      entry.messageId === event.payload.messageId;
    const reservationAtStart = queuedDispatchState.getReservation(sessionThreadId);
    const isPendingQueuedDispatch = matchesEvent(reservationAtStart);
    const ownsReservation = (entry: QueuedDispatchReservation | undefined) =>
      isPendingQueuedDispatch && entry?.id === reservationAtStart?.id;
    const clearPendingQueuedDispatch = Effect.sync(() => {
      if (
        reservationAtStart &&
        ownsReservation(queuedDispatchState.getReservation(sessionThreadId))
      ) {
        queuedDispatchState.clearIfOwned(sessionThreadId, reservationAtStart.id);
      }
    });
    const bindPendingQueuedDispatchToTurn = Effect.fnUntraced(function* (turnId: TurnId) {
      const reservation = queuedDispatchState.getReservation(sessionThreadId);
      if (reservation === undefined || !ownsReservation(reservation)) {
        return;
      }
      const completedBeforeBinding = queuedDispatchState.bindToTurn(
        sessionThreadId,
        reservation.id,
        turnId,
      );
      if (completedBeforeBinding) {
        yield* drainQueuedTurnsForSession(event.payload.threadId);
      }
    });
    // Safety net for a promoted queued dispatch that never reaches a turn. While this reservation is
    // present, `drainQueuedTurnsForThread` early-returns for every thread on this provider session, and
    // an unbound reservation also absorbs terminal turn events instead of draining — so leaking it
    // strands the thread's queued messages until the process restarts. `Effect.onExit`, never a JS
    // `finally`: a generator driven by `Effect.fnUntraced` is not resumed when a yielded effect fails
    // or is interrupted, so a `finally` here would simply never run on those paths. `onExit` rather
    // than `ensuring` because this release is itself fallible and must keep propagating its errors,
    // exactly as the `finally` did.
    const releaseOrphanedQueuedDispatchReservation = (redrain: boolean) =>
      Effect.gen(function* () {
        const reservation = queuedDispatchState.getReservation(sessionThreadId);
        if (
          !isPendingQueuedDispatch ||
          reservation === undefined ||
          !ownsReservation(reservation) ||
          reservation.releaseOnTurnId !== undefined
        ) {
          return;
        }
        if (yield* hasQueuedTurnStart(event.payload.threadId, event.payload.messageId)) {
          return;
        }
        const liveTurnId = yield* resolveLiveProviderTurnId(event.payload.threadId);
        if (liveTurnId !== undefined) {
          yield* bindPendingQueuedDispatchToTurn(liveTurnId);
          return;
        }
        yield* clearPendingQueuedDispatch;
        if (redrain) {
          yield* drainQueuedTurnsForSession(event.payload.threadId);
        }
      });
    yield* Effect.gen(function* () {
      const key = turnStartKeyForEvent(event);
      if (yield* hasHandledTurnStartRecently(key)) {
        return;
      }

      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      if (thread.claudeCacheReview) {
        if (thread.claudeCacheReview.messageId !== event.payload.messageId)
          yield* enqueueQueuedTurnStart(event);
        return;
      }

      const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
      if (!message || message.role !== "user") {
        yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.start.failed",
          summary: "Provider turn start failed",
          detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
          turnId: null,
          createdAt: event.payload.createdAt,
        });
        return;
      }

      // The decider routes turn starts from the projected session, which can lag the runtime: a message
      // dispatched right as another turn begins (e.g. the gap between a steer interrupt and the steered
      // turn's start) would race a live provider turn.
      const providerName = thread.session?.providerName ?? thread.modelSelection.provider;
      if (providerName === "claudeAgent" && /^\/compact(?:\s|$)/u.test(message.text.trim())) {
        if ((message.attachments?.length ?? 0) > 0) {
          return yield* new ProviderAdapterValidationError({
            provider: "claudeAgent",
            operation: "startClaudeCompaction",
            issue: "Remove attachments before compacting Claude context.",
          });
        }
        const instructions = message.text.trim().replace(/^\/compact\s*/u, "");
        yield* providerService.compactThread({
          threadId: event.payload.threadId,
          ...(instructions ? { instructions } : {}),
        });
        return;
      }
      const liveTurnId = yield* resolveLiveProviderTurnId(event.payload.threadId);
      const hasLiveTurn = liveTurnId !== undefined;

      const isNativeSteer =
        event.payload.dispatchMode === "steer" &&
        providerSupportsNativeTurnSteering(providerName) &&
        hasLiveTurn;
      if (event.payload.dispatchMode === "steer") {
        // The decider records its projected decision on the message immediately, then this runtime check
        // corrects either race direction before delivery: only a genuinely live native steer continues the
        // current turn.
        yield* orchestrationEngine.dispatch({
          type: "thread.message.user.set-turn-boundary",
          commandId: CommandId.makeUnsafe(
            `server:message-turn-boundary:${event.eventId}:${isNativeSteer ? "continuation" : "new-turn"}`,
          ),
          threadId: event.payload.threadId,
          messageId: message.id,
          startsNewTurn: !isNativeSteer,
          createdAt: event.payload.createdAt,
        });
      }
      if (!isNativeSteer && hasLiveTurn) {
        yield* enqueueQueuedTurnStart(event);

        yield* bindPendingQueuedDispatchToTurn(liveTurnId);
        if (event.payload.dispatchMode === "steer") {
          yield* interruptProviderTurn({
            threadId: event.payload.threadId,
            createdAt: event.payload.createdAt,
          });
        }
        return;
      }

      // Never touches a live session — a steer turn on a running provider session must keep its running
      // state and activeTurnId. The pre-turn session row can be an optimistic placeholder carrying a
      // stale provider; only defer to it for a real established binding, and otherwise honor the turn's
      // explicit requested selection.
      const sessionProviderEstablished =
        thread.session != null && (thread.session.status === "ready" || thread.latestTurn !== null);
      const turnStartSession = deriveTurnStartSession({
        threadId: event.payload.threadId,
        currentSession: thread.session,
        providerName: event.payload.modelSelection?.provider ?? providerName,
        requestedRuntimeMode: event.payload.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        requestedAt: event.payload.createdAt,
        sessionProviderEstablished,
      });
      if (turnStartSession !== null) {
        yield* setThreadSession({
          threadId: event.payload.threadId,
          session: turnStartSession,
          createdAt: event.payload.createdAt,
        });
      }

      const resolvedAttachments = yield* resolveProviderDispatchAttachments({
        attachments: message.attachments,
        attachmentsDir: serverConfig.attachmentsDir,
        repository: managedAttachments,
        threadId: event.payload.threadId,
        messageId: message.id,
        provider: providerName as ProviderKind,
        operation: "thread.turn.start",
      });

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: resolvedAttachments } : {}),
      }).pipe(Effect.forkScoped);

      const immediateDispatchMode =
        event.payload.dispatchMode === "steer" && !isNativeSteer
          ? "queue"
          : event.payload.dispatchMode;

      const startedTurn = yield* dispatchTurnForThread({
        sourceEvent: event,
        sourceEventSequence: event.sequence,
        completionEventSequence: deliveryEventSequence ?? event.sequence,
        threadId: event.payload.threadId,
        messageId: message.id,
        messageText: message.text,
        dispatchOrigin: event.payload.dispatchOrigin ?? "user",
        ...(message.attachments !== undefined ? { attachments: resolvedAttachments } : {}),
        ...(message.skills !== undefined ? { skills: message.skills } : {}),
        ...(message.mentions !== undefined ? { mentions: message.mentions } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.providerOptions !== undefined
          ? { providerOptions: event.payload.providerOptions }
          : {}),
        ...(event.payload.runtimeMode !== undefined
          ? { runtimeMode: event.payload.runtimeMode }
          : {}),
        ...(event.payload.reviewTarget !== undefined
          ? { reviewTarget: event.payload.reviewTarget }
          : {}),

        dispatchMode: immediateDispatchMode,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.gen(function* () {
                const detail = Cause.pretty(cause);
                if (event.payload.handoffOperationId) {
                  const transitions = handoffTransitions;
                  const current = yield* resolveThread(event.payload.threadId);
                  if (
                    current?.handoff?.operationId !== event.payload.handoffOperationId ||
                    current.handoff.stage === "cancelled"
                  ) {
                    if (
                      current?.handoff?.operationId === event.payload.handoffOperationId &&
                      current.handoff.stage === "cancelled" &&
                      current.session !== null &&
                      current.session.providerName ===
                        current.handoff.destinationModelSelection?.provider &&
                      current.handoff.sourceRetired
                    ) {
                      yield* orchestrationEngine
                        .dispatch({
                          type: "thread.session.set",
                          commandId: CommandId.makeUnsafe(
                            `server:handoff:late-start-cleared:${crypto.randomUUID()}`,
                          ),
                          threadId: event.payload.threadId,
                          expectedSessionStatus: current.session.status,
                          expectedSessionUpdatedAt: current.session.updatedAt,
                          session: {
                            threadId: event.payload.threadId,
                            providerName: null,
                            status: "stopped",
                            activeTurnId: null,
                            lastError: null,
                            runtimeMode: current.runtimeMode,
                            updatedAt: new Date().toISOString(),
                          },
                          createdAt: new Date().toISOString(),
                        })
                        .pipe(Effect.ignore);
                    }
                    return yield* Effect.failCause(cause);
                  }
                  if (
                    Option.isSome(transitions) &&
                    current?.handoff?.operationId === event.payload.handoffOperationId
                  ) {
                    const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
                    const uncertain =
                      current.handoff.stage === "activated" &&
                      !Schema.is(ProviderAdapterValidationError)(failure) &&
                      !Schema.is(ProviderValidationError)(failure);
                    yield* transitions.value
                      .update(event.payload.threadId, event.payload.handoffOperationId, {
                        stage: uncertain ? "uncertain" : "failed",
                        detail,
                      })
                      .pipe(Effect.ignore);
                  }
                }

                yield* appendProviderFailureActivity({
                  threadId: event.payload.threadId,
                  kind: "provider.turn.start.failed",
                  summary: "Provider turn start failed",
                  detail,
                  turnId: null,
                  createdAt: event.payload.createdAt,
                });
                const failure = Option.getOrUndefined(Cause.findErrorOption(cause));

                if (
                  Schema.is(ProviderAdapterValidationError)(failure) &&
                  failure.operation === "session/reconfigure"
                ) {
                  const optimisticSession = turnStartSession ?? thread.session;
                  const runtime = (yield* providerService.listSessions()).find(
                    (session) => session.threadId === event.payload.threadId,
                  );
                  if (
                    optimisticSession?.status === "starting" &&
                    runtime &&
                    runtime.activeTurnId == null
                  ) {
                    yield* setThreadSession({
                      threadId: event.payload.threadId,
                      session: {
                        threadId: event.payload.threadId,
                        providerName: runtime.provider,
                        runtimeMode: runtime.runtimeMode,
                        status:
                          runtime.status === "closed"
                            ? "stopped"
                            : runtime.status === "connecting"
                              ? "starting"
                              : runtime.status,
                        activeTurnId: null,
                        lastError: runtime.lastError ?? null,
                        updatedAt: runtime.updatedAt,
                      },
                      expectedSession: {
                        status: optimisticSession.status,
                        updatedAt: optimisticSession.updatedAt,
                      },
                      createdAt: event.payload.createdAt,
                    });
                  }
                  if (isPendingQueuedDispatch) yield* clearPendingQueuedDispatch;
                  return yield* Effect.failCause(cause);
                }
                yield* setThreadSessionError({
                  threadId: event.payload.threadId,
                  runtimeMode: event.payload.runtimeMode,
                  detail: providerFailureMessage(cause),
                  createdAt: event.payload.createdAt,
                });
                // A direct start has no provider turn and therefore cannot emit a terminal runtime event. Recover
                // every queue sharing this provider session now; otherwise follow-ups queued before the failure
                // remain stranded indefinitely (including child threads multiplexed onto their parent's provider
                // session).
                if (isPendingQueuedDispatch) {
                  yield* clearPendingQueuedDispatch;
                }
                yield* drainQueuedTurnsForSession(event.payload.threadId);
                return yield* Effect.failCause(cause);
              }),
        ),
        Effect.ensuring(
          Effect.sync(() =>
            threadSessionSettings.clearEditResendStart(
              event.payload.threadId,
              event.payload.messageId,
            ),
          ),
        ),
      );
      yield* maybeGenerateThreadTitle({
        threadId: thread.id,
        messageId: message.id,
        message: message.text,
        modelSelection:
          event.payload.modelSelection ??
          threadSessionSettings.getModelSelection(thread.id) ??
          thread.modelSelection,
        providerOptions:
          event.payload.providerOptions ?? threadSessionSettings.getProviderOptions(thread.id),
      }).pipe(Effect.forkScoped);
      // Persist the user/turn boundary as soon as the provider accepts a new turn. A turn that stops
      // before assistant text arrives otherwise leaves the user message without turn metadata, making
      // edit-and-resend vanish.
      if (startedTurn && !isNativeSteer) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.user.bind-turn",
          commandId: CommandId.makeUnsafe(
            `server:message-turn-bind:${event.eventId}:${startedTurn.turnId}`,
          ),
          threadId: event.payload.threadId,
          messageId: message.id,
          turnId: startedTurn.turnId,
          createdAt: event.payload.createdAt,
        });
      }
      if (startedTurn && isPendingQueuedDispatch) {
        yield* bindPendingQueuedDispatchToTurn(startedTurn.turnId);
      }
    }).pipe(
      Effect.onExit((exit) =>
        releaseOrphanedQueuedDispatchReservation(
          Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause),
        ),
      ),
    );
  });

  const processTurnStartRequested = (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) =>
    withProviderSessionLease(event.payload.threadId, processTurnStartRequestedWithoutLease(event));

  const processTurnQueued = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-queued" }>,
  ) {
    yield* enqueueQueuedTurnStart(event);
  });
  return { processTurnQueued, processTurnStartRequested };
}
