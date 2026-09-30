import { Effect, Cache, Ref, Queue, Deferred, Stream, Layer } from "effect";
import {
  ProviderCommandReactorConfig,
  ProviderCommandReactorLiveOptions,
} from "../Services/ProviderCommandReactorConfig";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationEventDeliveryRepository } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ComputerService } from "../../computer/Services/ComputerService";
import { AgentGatewaySessionRegistry } from "../../agentGateway/Services/AgentGatewaySessionRegistry";
import { ProviderHealth } from "../../provider/Services/ProviderHealth.ts";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ServerConfig } from "../../server/config.ts";
import {
  HANDLED_TURN_START_KEY_MAX,
  HANDLED_TURN_START_KEY_TTL,
  ProviderQueueDrainEvent,
} from "../providerCommands/deliveryClaims";
import {
  type ProviderCommandReactorShape,
  ProviderCommandReactor,
} from "../Services/ProviderCommandReactor.ts";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ThreadSessionSettings } from "../Services/ThreadSessionSettings.ts";
import { ThreadSessionSettingsLive } from "./ThreadSessionSettings.ts";
import { QueuedDispatchState } from "../Services/QueuedDispatchState.ts";
import { QueuedDispatchStateLive } from "./QueuedDispatchState.ts";
import { ProviderContextLifecycleActivityRecord } from "../providerCommands/contextLifecycle";
import { type OrchestrationRegenerateThreadTitleResult } from "@glade/contracts/orchestration/rpc";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { ProviderProjectionAccess } from "../Services/ProviderProjectionAccess.ts";
import { ProviderProjectionAccessLive } from "./ProviderProjectionAccess.ts";
import { ProviderDeliveryGate } from "../Services/ProviderDeliveryGate.ts";
import { ProviderDeliveryGateLive } from "./ProviderDeliveryGate.ts";
import { makeProviderThreadProjection } from "../providerCommands/threadProjection";
import { makeProviderHumanResponses } from "../providerCommands/humanResponses";
import { PROVIDER_COMMAND_EVENT_TIMEOUT } from "../providerCommands/providerCallPolicy";
import { OrchestrationEventDeliveryRepositoryLive } from "../../persistence/Layers/OrchestrationEventDeliveries.ts";
import { QueuedTurnPromotionRepositoryLive } from "../../persistence/Layers/QueuedTurnPromotions.ts";
import { ProjectionPendingInteractionRepositoryLive } from "../../persistence/Layers/ProjectionPendingInteractions.ts";
import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents.ts";
import {
  BlockedGoalContinuation,
  PendingInterruptEscalation,
  PendingContextBootstrapAttempt,
} from "../providerCommands/runtimeState";
import { makeProviderContextBootstrap } from "../providerCommands/contextBootstrap";
import { makeProviderSessionConfiguration } from "../providerCommands/sessionConfiguration";
import { makeProviderQueuedTurns } from "../providerCommands/queuedTurns";
import { makeProviderConversationEdit } from "../providerCommands/conversationEdit";
import { makeProviderTaskControl } from "../providerCommands/taskControl";
import { makeProviderTurnDispatch } from "../providerCommands/turnDispatch";
import { makeProviderConversationNaming } from "../providerCommands/conversationNaming";
import { makeProviderTurnStart } from "../providerCommands/turnStart";
import { makeProviderDeliveryAccess } from "../providerCommands/deliveryAccess";
import { makeProviderCompaction } from "../providerCommands/compaction";
import { makeProviderGoalContinuation } from "../providerCommands/goalContinuation";
import { makeProviderDomainEvents } from "../providerCommands/domainEvents";
import { makeProviderIntentSource } from "../providerCommands/intentSource";

const make = Effect.gen(function* () {
  const { commandEventTimeout } = yield* ProviderCommandReactorConfig;

  const orchestrationEngine = yield* OrchestrationEngineService;

  const deliveryRepository = yield* OrchestrationEventDeliveryRepository;

  const queuedTurnPromotions = yield* QueuedTurnPromotionRepository;

  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const providerService = yield* ProviderService;

  const computerService = yield* Effect.serviceOption(ComputerService);

  const gatewaySessions = yield* Effect.serviceOption(AgentGatewaySessionRegistry);

  const providerHealth = yield* ProviderHealth;

  const pendingInteractions = yield* ProjectionPendingInteractionRepository;

  const runtimeEventRepository = yield* ProviderRuntimeEventRepository;

  const checkpointStore = yield* CheckpointStore;

  const git = yield* GitCore;

  const gatewayOperations = yield* AgentGatewayOperationRepository;

  const deliveryGate = yield* ProviderDeliveryGate;

  const textGeneration = yield* TextGeneration;

  const serverSettings = yield* ServerSettingsService;

  const managedAttachments = yield* ManagedAttachmentRepository;

  const serverConfig = yield* ServerConfig;

  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const threadSessionSettings = yield* ThreadSessionSettings;

  const queuedDispatchState = yield* QueuedDispatchState;

  // A blocked continuation cannot keep its durable delivery open: approval, input, and queued-work
  // intents behind it may be the only way to clear the blocker.
  const blockedGoalContinuations = new Map<string, BlockedGoalContinuation>();

  const queuedGoalContinuationRetries = new Set<string>();

  const goalContinuationRetryQueue = yield* Queue.unbounded<ThreadId>();

  const queuedTurnPromotionOwner = `provider-queued-turn:${crypto.randomUUID()}`;

  const freshSessionContextBootstrapThreadIds = new Set<string>();

  const pendingInterruptEscalations = new Map<string, PendingInterruptEscalation>();

  const pendingProviderContextLifecycleActivities = new Map<
    string,
    ProviderContextLifecycleActivityRecord
  >();

  const queuedProviderContextLifecycleActivityRetries = new Set<string>();

  const providerContextLifecycleActivityRetryQueue = yield* Queue.unbounded<string>();

  const pendingContextBootstrapAttempts = new Map<string, PendingContextBootstrapAttempt>();

  const suppressContextBootstrapOnNextStartThreadIds = new Set<string>();

  const earlyClaudeCompactionTerminals = new Map<ThreadId, ProviderQueueDrainEvent>();

  const pendingClaudeCompactionIngestion = new Set<ThreadId>();

  const startupClaudeCompactionTurns = new Set<TurnId>();

  const recoveringClaudeCompactions = yield* Ref.make(true);

  const pendingTitleGenerations = new Map<
    ThreadId,
    Deferred.Deferred<OrchestrationRegenerateThreadTitleResult, TaggedFailure>
  >();

  const projectionAccess = yield* ProviderProjectionAccess;

  const {
    setThreadSession,
    isClaudeReviewAuthorized,
    setClaudeCacheReview,
    pauseActiveThreadGoal,
    appendProviderFailureActivity,
    setThreadSessionError,
    settleInterruptedProviderTurn,
    surfaceTimedOutTurnStart,
    surfaceTimedOutGoalContinuation,
  } = makeProviderThreadProjection({
    projectionAccess,
    orchestrationEngine,
  });

  const { processApprovalResponseRequested, processUserInputResponseRequested } =
    makeProviderHumanResponses({
      projectionAccess,
      appendProviderFailureActivity,
      pendingInteractions,
      providerService,
    });

  const {
    clearPendingContextBootstraps,
    completeInterruptEscalation,
    completePendingContextBootstrapAttempt,
    retainAndAppendProviderContextLifecycleActivity,
    toProviderContextLifecycleActivityRecord,
    persistPriorTranscriptBootstrapCompletion,
    observePendingContextBootstrapTerminalEvent,
    runProviderContextLifecycleActivityRetries,
  } = makeProviderContextBootstrap({
    pendingInterruptEscalations,
    orchestrationEngine,
    pendingProviderContextLifecycleActivities,
    queuedProviderContextLifecycleActivityRetries,
    providerContextLifecycleActivityRetryQueue,
    providerService,
    pendingContextBootstrapAttempts,
    freshSessionContextBootstrapThreadIds,
  });
  const { ensureSessionForThread, clearStaleProviderResumeState, clearThreadRuntimeCaches } =
    makeProviderSessionConfiguration({
      projectionAccess,
      threadSessionSettings,
      deliveryGate,
      blockedGoalContinuations,
      queuedGoalContinuationRetries,
      suppressContextBootstrapOnNextStartThreadIds,
      clearPendingContextBootstraps,
      pendingInterruptEscalations,
      pendingProviderContextLifecycleActivities,
      providerService,
      serverSettings,
      setThreadSession,
      gatewaySessions,
      computerService,
      freshSessionContextBootstrapThreadIds,
    });
  const {
    drainQueuedTurnsForSession,
    hasQueuedTurnStart,
    hasHandledTurnStartRecently,
    enqueueQueuedTurnStart,
    readOrchestrationEventAtSequence,
    hasPendingQueuedTurnForSession,
    recoverQueuedTurnPromotionsForThread,
    recoverQueuedTurnPromotions,
  } = makeProviderQueuedTurns({
    projectionAccess,
    handledTurnStartKeys,
    queuedTurnPromotions,
    orchestrationEngine,
    queuedDispatchState,
    queuedTurnPromotionOwner,
  });
  const { processConversationRollbackRequested, processMessageEditResendRequested } =
    makeProviderConversationEdit({
      projectionAccess,
      providerService,
      checkpointStore,
      orchestrationEngine,
      queuedTurnPromotions,
      threadSessionSettings,
      setThreadSession,
    });
  const {
    interruptProviderTurn,
    processThreadSessionStop,
    processTurnInterruptRequested,
    processTaskStopRequested,
    processTaskBackgroundRequested,
    processSessionStopRequested,
  } = makeProviderTaskControl({
    projectionAccess,
    computerService,
    appendProviderFailureActivity,
    settleInterruptedProviderTurn,
    providerService,
    queuedTurnPromotions,
    setClaudeCacheReview,
    threadSessionSettings,
    queuedDispatchState,
    clearPendingContextBootstraps,
    pendingInterruptEscalations,
    suppressContextBootstrapOnNextStartThreadIds,
    setThreadSession,
    pauseActiveThreadGoal,
  });
  const { dispatchTurnForThread } = makeProviderTurnDispatch({
    projectionAccess,
    projectionSnapshotQuery,
    serverConfig,
    managedAttachments,
    providerService,
    computerService,
    threadSessionSettings,
    ensureSessionForThread,
    isClaudeReviewAuthorized,
    setClaudeCacheReview,
    pauseActiveThreadGoal,
    appendProviderFailureActivity,
    gatewayOperations,
    pendingInterruptEscalations,
    freshSessionContextBootstrapThreadIds,
    checkpointStore,
    pendingContextBootstrapAttempts,
    clearStaleProviderResumeState,
    deliveryGate,
    completeInterruptEscalation,
    completePendingContextBootstrapAttempt,
    retainAndAppendProviderContextLifecycleActivity,
    toProviderContextLifecycleActivityRecord,
    orchestrationEngine,
    persistPriorTranscriptBootstrapCompletion,
  });
  const {
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
    maybeGenerateAndRenameThreadTitleForFirstTurn,
    regenerateThreadTitle,
  } = makeProviderConversationNaming({
    projectionAccess,
    gatewayOperations,
    serverSettings,
    threadSessionSettings,
    providerHealth,
    git,
    orchestrationEngine,
    textGeneration,
    pendingTitleGenerations,
  });
  const { processTurnStartRequestedWithoutLease, processTurnQueued, processTurnStartRequested } =
    makeProviderTurnStart({
      projectionAccess,
      queuedDispatchState,
      drainQueuedTurnsForSession,
      hasQueuedTurnStart,
      hasHandledTurnStartRecently,
      enqueueQueuedTurnStart,
      appendProviderFailureActivity,
      computerService,
      gatewaySessions,
      threadSessionSettings,
      orchestrationEngine,
      interruptProviderTurn,
      setThreadSession,
      serverConfig,
      managedAttachments,
      maybeGenerateAndRenameWorktreeBranchForFirstTurn,
      maybeGenerateAndRenameThreadTitleForFirstTurn,
      dispatchTurnForThread,
      providerService,
      setThreadSessionError,
      setClaudeCacheReview,
    });
  const { reconcileDelivery, drain, listBlockingDeliveries } = makeProviderDeliveryAccess({
    orchestrationEngine,
    deliveryRepository,
    deliveryGate,
  });
  const {
    processClaudeCompactionTerminal,
    processClaudeCacheResponse,
    readClaudeCompactionTerminal,
    readClaudeCompactionAttempt,
    recoverClaudeCompactions,
  } = makeProviderCompaction({
    projectionAccess,
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
  });
  const {
    processGoalContinuationRequested,
    recoverActiveThreadGoals,
    runBlockedGoalContinuationRetries,
  } = makeProviderGoalContinuation({
    projectionAccess,
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
  });
  const {
    processDomainEvent,
    processDomainEventSafely,
    recoverQueuedTurnAfterDeliverySafely,
    processQueueDrainEventSafely,
  } = makeProviderDomainEvents({
    projectionAccess,
    processClaudeCompactionTerminal,
    observePendingContextBootstrapTerminalEvent,
    queuedDispatchState,
    drainQueuedTurnsForSession,
    threadSessionSettings,
    computerService,
    queuedTurnPromotions,
    clearThreadRuntimeCaches,
    processThreadSessionStop,
    orchestrationEngine,
    ensureSessionForThread,
    processTurnQueued,
    processTurnStartRequested,
    processClaudeCacheResponse,
    processGoalContinuationRequested,
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
  });
  const { startProviderIntentSource } = makeProviderIntentSource({
    projectionAccess,
    orchestrationEngine,
    deliveryRepository,
    deliveryGate,
    setClaudeCacheReview,
    appendProviderFailureActivity,
    setThreadSessionError,
    readClaudeCompactionTerminal,
    commandEventTimeout,
    processDomainEvent,
    surfaceTimedOutTurnStart,
    surfaceTimedOutGoalContinuation,
    gatewayOperations,
    processDomainEventSafely,
    recoverQueuedTurnAfterDeliverySafely,
    earlyClaudeCompactionTerminals,
    readClaudeCompactionAttempt,
    processClaudeCompactionTerminal,
    readOrchestrationEventAtSequence,
    setThreadSession,
  });

  const seedThreadModelSelections = orchestrationEngine.getReadModel().pipe(
    Effect.map((snapshot) => {
      for (const thread of snapshot.threads) {
        threadSessionSettings.setModelSelection(thread.id, thread.modelSelection);
      }
    }),
  );

  const start = seedThreadModelSelections.pipe(
    Effect.andThen(
      Effect.all([
        startProviderIntentSource.pipe(
          Effect.andThen(
            recoverClaudeCompactions.pipe(
              Effect.ensuring(
                Ref.modify(recoveringClaudeCompactions, () => {
                  startupClaudeCompactionTurns.clear();
                  return [undefined, false] as const;
                }),
              ),
            ),
          ),
          Effect.andThen(recoverQueuedTurnPromotions),
          Effect.andThen(recoverActiveThreadGoals),
        ),
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type !== "turn.completed" && event.type !== "turn.aborted") {
            return Effect.void;
          }
          return processQueueDrainEventSafely(event);
        }).pipe(Effect.forkScoped),
        runBlockedGoalContinuationRetries.pipe(Effect.forkScoped),
        runProviderContextLifecycleActivityRetries.pipe(Effect.forkScoped),
      ]).pipe(Effect.asVoid),
    ),
    Effect.orDie,
  ) as ProviderCommandReactorShape["start"];

  return {
    start,
    drain,
    listBlockingDeliveries,
    reconcileDelivery,
    regenerateThreadTitle,
  } satisfies ProviderCommandReactorShape;
});

export const makeProviderCommandReactorLive = (options?: ProviderCommandReactorLiveOptions) =>
  Layer.effect(ProviderCommandReactor, make).pipe(
    Layer.provide(
      Layer.succeed(ProviderCommandReactorConfig, {
        commandEventTimeout: options?.commandEventTimeout ?? PROVIDER_COMMAND_EVENT_TIMEOUT,
      }),
    ),
    Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
    Layer.provideMerge(QueuedTurnPromotionRepositoryLive),
    Layer.provideMerge(ProjectionPendingInteractionRepositoryLive),
    Layer.provideMerge(ProviderRuntimeEventRepositoryLive),
    Layer.provide(
      Layer.fresh(
        Layer.mergeAll(
          ThreadSessionSettingsLive,
          QueuedDispatchStateLive,
          ProviderDeliveryGateLive,
        ),
      ),
    ),
    Layer.provide(ProviderProjectionAccessLive),
  );

export const ProviderCommandReactorLive = makeProviderCommandReactorLive();
