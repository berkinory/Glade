import type { ServiceMap } from "effect";
import { makeProviderProjectionAccess } from "./projectionAccess";
import { makeProviderThreadProjection } from "./threadProjection";
import { Option, Effect, Cause, Schema, Exit } from "effect";
import { ComputerService } from "../../computer/Services/ComputerService";
import { AgentGatewaySessionRegistry } from "../../agentGateway/Services/AgentGatewaySessionRegistry";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ServerConfig } from "../../server/config.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { type PendingClaudeCacheReview } from "@glade/contracts/orchestration/threadEntities";
import { TurnId, ProviderKind, CommandId } from "@glade/contracts/core/baseSchemas";
import { turnStartKeyForEvent } from "./deliveryClaims";
import { computerActivationMetadata } from "../../computer/computerActivation.ts";
import { providerSupportsNativeTurnSteering } from "@glade/shared/provider/providerMetadata";
import { deriveTurnStartSession } from "../turnStartSession.ts";
import { DEFAULT_RUNTIME_MODE } from "./contextLifecycle";
import { resolveProviderDispatchAttachments } from "../../provider/core/providerAttachmentPaths.ts";
import { ProviderAdapterValidationError } from "../../provider/core/Errors.ts";
import { providerFailureMessage } from "./providerCallPolicy";
import { PendingQueuedDispatch } from "./runtimeState";
import { makeProviderQueuedTurns } from "./queuedTurns";
import { makeProviderTaskControl } from "./taskControl";
import { makeProviderConversationNaming } from "./conversationNaming";
import { makeProviderSessionConfiguration } from "./sessionConfiguration";
import { makeProviderTurnDispatch } from "./turnDispatch";

export function makeProviderTurnStart(input: {
  readonly resolveProviderSessionThread: ReturnType<
    typeof makeProviderProjectionAccess
  >["resolveProviderSessionThread"];
  readonly pendingQueuedDispatchBySessionThread: Map<string, PendingQueuedDispatch>;
  readonly drainQueuedTurnsForSession: ReturnType<
    typeof makeProviderQueuedTurns
  >["drainQueuedTurnsForSession"];
  readonly hasQueuedTurnStart: ReturnType<typeof makeProviderQueuedTurns>["hasQueuedTurnStart"];
  readonly resolveLiveProviderTurnId: ReturnType<
    typeof makeProviderProjectionAccess
  >["resolveLiveProviderTurnId"];
  readonly hasHandledTurnStartRecently: ReturnType<
    typeof makeProviderQueuedTurns
  >["hasHandledTurnStartRecently"];
  readonly resolveThread: ReturnType<typeof makeProviderProjectionAccess>["resolveThread"];
  readonly enqueueQueuedTurnStart: ReturnType<
    typeof makeProviderQueuedTurns
  >["enqueueQueuedTurnStart"];
  readonly appendProviderFailureActivity: ReturnType<
    typeof makeProviderThreadProjection
  >["appendProviderFailureActivity"];
  readonly computerService: Option.Option<ServiceMap.Service.Shape<typeof ComputerService>>;
  readonly gatewaySessions: Option.Option<
    ServiceMap.Service.Shape<typeof AgentGatewaySessionRegistry>
  >;
  readonly threadSessionComputerControl: Map<string, boolean>;
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
  readonly maybeGenerateAndRenameThreadTitleForFirstTurn: ReturnType<
    typeof makeProviderConversationNaming
  >["maybeGenerateAndRenameThreadTitleForFirstTurn"];
  readonly editResendTurnStartKey: ReturnType<
    typeof makeProviderSessionConfiguration
  >["editResendTurnStartKey"];
  readonly dispatchTurnForThread: ReturnType<
    typeof makeProviderTurnDispatch
  >["dispatchTurnForThread"];
  readonly providerService: ServiceMap.Service.Shape<typeof ProviderService>;
  readonly setThreadSessionError: ReturnType<
    typeof makeProviderThreadProjection
  >["setThreadSessionError"];
  readonly editResendTurnStartKeys: Set<string>;
  readonly setClaudeCacheReview: ReturnType<
    typeof makeProviderThreadProjection
  >["setClaudeCacheReview"];
  readonly withProviderSessionLease: ReturnType<
    typeof makeProviderProjectionAccess
  >["withProviderSessionLease"];
}) {
  const {
    resolveProviderSessionThread,
    pendingQueuedDispatchBySessionThread,
    drainQueuedTurnsForSession,
    hasQueuedTurnStart,
    resolveLiveProviderTurnId,
    hasHandledTurnStartRecently,
    resolveThread,
    enqueueQueuedTurnStart,
    appendProviderFailureActivity,
    computerService,
    gatewaySessions,
    threadSessionComputerControl,
    orchestrationEngine,
    interruptProviderTurn,
    setThreadSession,
    serverConfig,
    managedAttachments,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
    maybeGenerateAndRenameThreadTitleForFirstTurn,
    editResendTurnStartKey,
    dispatchTurnForThread,
    providerService,
    setThreadSessionError,
    editResendTurnStartKeys,
    setClaudeCacheReview,
    withProviderSessionLease,
  } = input;
  const processTurnStartRequestedWithoutLease = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
    acceptedCacheReview?: PendingClaudeCacheReview,
    deliveryEventSequence?: number,
  ) {
    const sessionThreadId =
      (yield* resolveProviderSessionThread(event.payload.threadId))?.id ?? event.payload.threadId;
    const matchesEvent = (entry: PendingQueuedDispatch | undefined) =>
      entry?.queuedThreadId === (event.payload.threadId as string) &&
      entry.messageId === event.payload.messageId;
    const reservationAtStart = pendingQueuedDispatchBySessionThread.get(sessionThreadId);
    const isPendingQueuedDispatch = matchesEvent(reservationAtStart);
    const ownsReservation = (entry: PendingQueuedDispatch | undefined) =>
      isPendingQueuedDispatch && entry === reservationAtStart;
    const clearPendingQueuedDispatch = Effect.sync(() => {
      if (ownsReservation(pendingQueuedDispatchBySessionThread.get(sessionThreadId))) {
        pendingQueuedDispatchBySessionThread.delete(sessionThreadId);
      }
    });
    const bindPendingQueuedDispatchToTurn = Effect.fnUntraced(function* (turnId: TurnId) {
      const reservation = pendingQueuedDispatchBySessionThread.get(sessionThreadId);
      if (reservation === undefined || !ownsReservation(reservation)) {
        return;
      }
      reservation.releaseOnTurnId = turnId;
      const completedBeforeBinding = reservation.pendingTerminalTurnIds?.has(turnId);
      delete reservation.pendingTerminalTurnIds;
      if (completedBeforeBinding) {
        pendingQueuedDispatchBySessionThread.delete(sessionThreadId);
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
        const reservation = pendingQueuedDispatchBySessionThread.get(sessionThreadId);
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
      if (!acceptedCacheReview && (yield* hasHandledTurnStartRecently(key))) {
        return;
      }

      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      if (
        thread.claudeCacheReview &&
        thread.claudeCacheReview.reviewId !== acceptedCacheReview?.reviewId
      ) {
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
      const liveTurnId = yield* resolveLiveProviderTurnId(event.payload.threadId);
      const hasLiveTurn = liveTurnId !== undefined;

      const activation = computerActivationMetadata(event.payload);
      const requiresComputerProfile =
        hasLiveTurn &&
        event.payload.dispatchMode === "steer" &&
        activation.enableComputerControl &&
        (Option.isNone(computerService) ||
          computerService.value.manager.canActivateControl(
            event.payload.threadId,
            activation.computerControlGeneration,
          )) &&
        !(Option.isSome(gatewaySessions) && gatewaySessions.value.computerControlProvisioned
          ? gatewaySessions.value.computerControlProvisioned(
              event.payload.threadId,
              providerName as ProviderKind,
            )
          : (threadSessionComputerControl.get(event.payload.threadId) ?? false));
      // Installing a new catalog requires a turn boundary; a live steer cannot gain tools merely because
      // the composer consumed its activation chip.
      const isNativeSteer =
        event.payload.dispatchMode === "steer" &&
        providerSupportsNativeTurnSteering(providerName) &&
        hasLiveTurn &&
        !requiresComputerProfile;
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
      yield* maybeGenerateAndRenameThreadTitleForFirstTurn({
        threadId: event.payload.threadId,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: resolvedAttachments } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.providerOptions !== undefined
          ? { providerOptions: event.payload.providerOptions }
          : {}),
      }).pipe(Effect.forkScoped);

      const immediateDispatchMode =
        event.payload.dispatchMode === "steer" && !isNativeSteer
          ? "queue"
          : event.payload.dispatchMode;
      const editResendKey = editResendTurnStartKey(event.payload.threadId, event.payload.messageId);

      const startedTurn = yield* dispatchTurnForThread({
        cacheReviewSource: event,
        sourceEventSequence: event.sequence,
        completionEventSequence: deliveryEventSequence ?? event.sequence,
        ...(acceptedCacheReview ? { acceptedCacheReview } : {}),
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
        ...computerActivationMetadata(event.payload),
        ...(event.payload.runtimeMode !== undefined
          ? { runtimeMode: event.payload.runtimeMode }
          : {}),
        ...(event.payload.reviewTarget !== undefined
          ? { reviewTarget: event.payload.reviewTarget }
          : {}),
        interactionMode: event.payload.interactionMode,
        dispatchMode: immediateDispatchMode,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.gen(function* () {
                const detail = Cause.pretty(cause);
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
        Effect.ensuring(Effect.sync(() => editResendTurnStartKeys.delete(editResendKey))),
      );
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
      if (startedTurn && acceptedCacheReview) {
        yield* setClaudeCacheReview(event.payload.threadId, null, acceptedCacheReview.reviewId);
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
  return { processTurnStartRequestedWithoutLease, processTurnQueued, processTurnStartRequested };
}
