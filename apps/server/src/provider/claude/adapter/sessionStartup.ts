import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import type { Fiber } from "effect";
import type { ClaudeSessionAccessShape } from "../../Services/ClaudeSessionAccess.ts";
import { Effect, Ref, Exit } from "effect";
import type { ThreadId, EventId } from "@glade/contracts/core/baseSchemas";
import { ClaudeQueryRuntime } from "./adapterConfiguration";
import type { ClaudeProcessOwnershipShape } from "../../Services/ClaudeProcessOwnership.ts";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { makeClaudeSessionTeardown } from "./sessionTeardown";
import { type AgentGatewayCredentialsShape } from "../../../agentGateway/Services/AgentGatewayCredentials.ts";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";

import type { SDKUserMessage, Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import { makeClaudeSdkStream } from "./sdkStream";
import { makeKeyedLock } from "../../core/keyedLock.ts";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { makeClaudeMonitorEventCursor } from "../claudeMonitorEvents.ts";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { ClaudeRequestUsage } from "../claudeRequestUsage.ts";
import { makeClaudeDiscovery } from "./discovery";
import type { ServerConfigShape } from "../../../server/config.ts";
import type { ServerSettingsError } from "@glade/contracts/settings/settings";
import { type ClaudeLaunch, makeClaudeSessionLaunch } from "./sessionLaunch";
import { makeClaudeWarmLaunches } from "./warmLaunches";

// A parked runtime holds a few hundred MB, so only the threads someone is typing in keep one.
const WARM_LAUNCH_TTL = "90 seconds";
const WARM_LAUNCH_CAPACITY = 2;

export function makeClaudeSessionStartup(input: {
  readonly resolveClaudeStartPreflight: ClaudeSessionAccessShape["resolveClaudeStartPreflight"];
  readonly nowIso: Effect.Effect<string>;
  readonly processOwnership: ClaudeProcessOwnershipShape;
  readonly sessions: ClaudeSessionRegistryShape;
  readonly assertSessionReplaceable: ClaudeSessionAccessShape["assertSessionReplaceable"];
  readonly stopSessionInternal: ReturnType<typeof makeClaudeSessionTeardown>["stopSessionInternal"];
  readonly agentGatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly serverConfig: ServerConfigShape;
  readonly getDisabledSkillNames: Effect.Effect<ReadonlyArray<string>, ServerSettingsError, never>;
  readonly runSdkFork: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly settlePendingUserInput: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingUserInput"];
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;

  readonly settlePendingApproval: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingApproval"];
  readonly bindClaudeProcessOwner: ClaudeProcessOwnershipShape["bindClaudeProcessOwner"];
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => Promise<ClaudeQueryRuntime>;
  readonly verifyClaudeAutoModelSupport: ReturnType<
    typeof makeClaudeDiscovery
  >["verifyClaudeAutoModelSupport"];
  readonly runSdkStream: ReturnType<typeof makeClaudeSdkStream>["runSdkStream"];
  readonly handleStreamExit: ReturnType<typeof makeClaudeSdkStream>["handleStreamExit"];
  readonly withSessionLifecycleLock: ReturnType<typeof makeKeyedLock<ThreadId>>["withLock"];
}) {
  const {
    resolveClaudeStartPreflight,
    nowIso,
    processOwnership,
    sessions,
    assertSessionReplaceable,
    stopSessionInternal,
    agentGatewayCredentials,
    serverConfig,
    getDisabledSkillNames,
    runSdkFork,
    makeEventStamp,
    offerRuntimeEvent,
    settlePendingUserInput,
    runSdkPromise,

    settlePendingApproval,
    bindClaudeProcessOwner,
    createQuery,
    verifyClaudeAutoModelSupport,
    runSdkStream,
    handleStreamExit,
    withSessionLifecycleLock,
  } = input;

  const { planLaunch, launch } = makeClaudeSessionLaunch({
    resolveClaudeStartPreflight,
    getDisabledSkillNames,
    processOwnership,
    agentGatewayCredentials,
    serverConfig,
    runSdkFork,
    runSdkPromise,
    makeEventStamp,
    offerRuntimeEvent,
    settlePendingUserInput,
    settlePendingApproval,
    bindClaudeProcessOwner,
    createQuery,
    verifyClaudeAutoModelSupport,
  });
  const warmLaunches = makeClaudeWarmLaunches<ClaudeLaunch>({
    ttl: WARM_LAUNCH_TTL,
    capacity: WARM_LAUNCH_CAPACITY,
    runFork: runSdkFork,
  });

  const install = (
    input: Parameters<ClaudeAdapterShape["startSession"]>[0],
    launched: ClaudeLaunch,
  ): Effect.Effect<ProviderSession> => {
    let installing: ClaudeSessionContext | undefined;
    return Effect.gen(function* () {
      const {
        resumeState,
        existingResumeSessionId,
        promptQueue,
        contextRef,
        pendingApprovals,
        pendingUserInputs,
        pendingSubagentStops,
        inFlightTools,
        modelSelection,
        apiModelId,
        thinking,
        fastMode,
        ultracode,
        effectiveEffort,
        permissionMode,
        maxThinkingTokens,
        claudeConfigDir,
        gatewaySessionLease,
        skillBridge,
        queryRuntime,
        messageStream,
        processOwner,
        initialization,
      } = launched;
      const threadId = input.threadId;
      const startedAt = yield* nowIso;
      const processedTokenBaselineKnown =
        input.resumeCursor === undefined || resumeState?.processedTokenTotal !== undefined;
      const session: ProviderSession = {
        threadId,
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(threadId ? { threadId } : {}),
        resumeCursor: {
          ...(threadId ? { threadId } : {}),
          ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
          ...(resumeState?.resumeSessionAt ? { resumeSessionAt: resumeState.resumeSessionAt } : {}),
          turnCount: resumeState?.turnCount ?? 0,
          ...(processedTokenBaselineKnown
            ? {
                processedTokenTotal: resumeState?.processedTokenTotal ?? 0,
                tokenAccountingVersion: 1,
              }
            : {}),
        },
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      const context: ClaudeSessionContext = {
        ...(gatewaySessionLease ? { gatewaySessionLease } : {}),
        session,
        startInput: input,
        ...(input.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: input.lifecycleGeneration }
          : {}),
        promptQueue,
        query: queryRuntime,
        messageStream,
        processOwner,
        streamFiber: undefined,
        startedAt,
        skillBridgeCleanup: skillBridge.cleanup,
        allowedSkillNames: new Set(skillBridge.enabledSkills),
        ...(claudeConfigDir ? { claudeConfigDir } : {}),
        monitorEventCursor: makeClaudeMonitorEventCursor(),
        basePermissionMode: permissionMode,
        spawnPermissionMode: permissionMode,
        firstTurnSpawnModeAuthoritative: true,

        currentApiModelId: apiModelId,
        resumeSessionId: existingResumeSessionId,
        pendingApprovals,
        approvalsAlwaysAllowedForSession: false,
        pendingUserInputs,
        turns: [],
        inFlightTools,
        turnState: undefined,
        lastTurnId: undefined,
        interruptRequestedTurnId: undefined,
        availableModels: initialization.models,
        fastModeState: initialization.fast_mode_state,
        fastModeDisabledReason: initialization.fast_mode_disabled_reason,
        ...(existingResumeSessionId ? { resultUsageMayIncludeRestoredTotals: true } : {}),
        lastKnownContextWindow: undefined,
        currentAlwaysThinkingEnabled: thinking,
        currentEffort: effectiveEffort,
        effectiveEffort: undefined,
        currentUltracode: ultracode,
        currentFastMode: fastMode,
        lastKnownAutoCompactThreshold: undefined,
        contextUsageControlEnabled: true,
        lastKnownTokenUsage: undefined,
        tokenUsageState: "current",
        compactionMessageId: undefined,
        processedTokenTotal: resumeState?.processedTokenTotal ?? 0,
        processedTokenTurnBaseline: resumeState?.processedTokenTotal ?? 0,
        processedTokenResultBaseline: resumeState?.processedTokenTotal ?? 0,
        processedTokenBaselineKnown,
        requestUsage: new ClaudeRequestUsage(),
        lastResultUuid: undefined,
        lastAssistantUuid: resumeState?.resumeSessionAt,
        lastThreadStartedId: undefined,
        emittedContextUsageWarnings: new Set(),
        stopped: false,
        warnedUnhandledSdkKinds: new Set(),
        subagentRuns: new Map(),
        pendingSubagentStops,
        knownBackgroundTaskIds: new Set(),
        terminalTaskIds: new Set(),
        foregroundTaskIds: new Set(),
        settledSubagentToolUseIds: new Map(),
        subagentToolUseIdByAgentId: new Map(),
        subagentToolUseIdAliases: new Map(),
        liveWorkflowTaskIds: new Set(),
        knownWorkflowTaskIds: new Set(),
        workflowTaskIdByMemberTaskId: new Map(),
        workflowRuntimePollers: new Map(),
        workflowAgentLabels: new Map(),
        workflowRuntimeStates: new Map(),
      };
      installing = context;
      yield* Effect.gen(function* () {
        yield* Ref.set(contextRef, context);
        yield* sessions.register(threadId, context);

        const sessionStartedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "session.started",
          eventId: sessionStartedStamp.eventId,
          provider: PROVIDER,
          createdAt: sessionStartedStamp.createdAt,
          threadId,
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
          providerRefs: {},
        });

        const configuredStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "session.configured",
          eventId: configuredStamp.eventId,
          provider: PROVIDER,
          createdAt: configuredStamp.createdAt,
          threadId,
          payload: {
            config: {
              ...(modelSelection?.model ? { model: modelSelection.model } : {}),
              ...(apiModelId ? { apiModelId } : {}),
              ...(input.cwd ? { cwd: input.cwd } : {}),
              ...(effectiveEffort ? { effort: effectiveEffort } : {}),
              permissionMode,
              ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
              ...(fastMode ? { fastMode: true } : {}),
              ...(ultracode ? { ultracode: true } : {}),
              ...(initialization.fast_mode_state
                ? { fastModeState: initialization.fast_mode_state }
                : {}),
              ...(initialization.fast_mode_disabled_reason
                ? { fastModeDisabledReason: initialization.fast_mode_disabled_reason }
                : {}),
            },
          },
          providerRefs: {},
        });

        const readyStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "session.state.changed",
          eventId: readyStamp.eventId,
          provider: PROVIDER,
          createdAt: readyStamp.createdAt,
          threadId,
          payload: {
            state: "ready",
          },
          providerRefs: {},
        });

        const streamFiber = runSdkFork(runSdkStream(context));
        context.streamFiber = streamFiber;
        streamFiber.addObserver((exit) => {
          if (context.stopped) {
            return;
          }
          if (context.streamFiber === streamFiber) {
            context.streamFiber = undefined;
          }
          runSdkFork(handleStreamExit(context, exit));
        });
      });
      return { ...context.session };
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        return installing === undefined
          ? launched.release
          : stopSessionInternal(installing, { emitExitEvent: false }).pipe(Effect.ignore);
      }),
    );
  };

  const startSessionUnlocked = (
    input: Parameters<ClaudeAdapterShape["startSession"]>[0],
    preflight?: Effect.Success<ReturnType<typeof resolveClaudeStartPreflight>>,
  ): ReturnType<ClaudeAdapterShape["startSession"]> =>
    Effect.gen(function* () {
      const threadId = input.threadId;
      const plan = yield* planLaunch(input, preflight);
      const failedStartupProcessOwner = processOwnership.failedStartupOwner(threadId);
      if (failedStartupProcessOwner) {
        yield* processOwnership.teardownFailedStartupProcess(threadId, failedStartupProcessOwner);
      }
      const existing = sessions.get(threadId);
      if (existing) {
        yield* assertSessionReplaceable(threadId);

        yield* stopSessionInternal(existing, { emitExitEvent: false });
      }
      const launched =
        (yield* warmLaunches.take(threadId, plan.key)) ?? (yield* launch(input, plan));
      return yield* install(input, launched);
    });

  const startSession: ClaudeAdapterShape["startSession"] = (input) =>
    withSessionLifecycleLock(input.threadId, startSessionUnlocked(input));

  // Holding the lifecycle lock while launching makes a start that arrives meanwhile wait and claim
  // this runtime instead of spawning a second one.
  const prewarmSession: NonNullable<ClaudeAdapterShape["prewarmSession"]> = (input) =>
    withSessionLifecycleLock(
      input.threadId,
      Effect.gen(function* () {
        const threadId = input.threadId;
        if (sessions.get(threadId) || processOwnership.failedStartupOwner(threadId)) return;
        const plan = yield* planLaunch(input);
        if (warmLaunches.refresh(threadId, plan.key)) return;
        yield* warmLaunches.discard(threadId);
        yield* warmLaunches.park(threadId, yield* launch(input, plan));
      }),
    );

  return {
    startSessionUnlocked,
    startSession,
    prewarmSession,
    discardWarmLaunch: warmLaunches.discard,
    discardWarmLaunches: warmLaunches.discardAll,
  };
}
