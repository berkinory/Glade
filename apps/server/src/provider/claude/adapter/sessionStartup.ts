import type { Fiber } from "effect";
import { makeClaudeSessionAccess } from "./sessionAccess";
import { Effect, Clock, Random, Queue, Stream, Cause, Ref, Exit } from "effect";
import { ThreadId, EventId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { ClaudeProcessOwner, ClaudeQueryRuntime } from "./adapterConfiguration";
import { makeClaudeProcessOwnership } from "./processOwnership";
import {
  ClaudeSessionContext,
  PROVIDER,
  PromptQueueItem,
  PendingApproval,
  PendingUserInput,
  ToolInFlight,
} from "./sessionTypes";
import { makeClaudeSessionTeardown } from "./sessionTeardown";
import { type AgentGatewayCredentialsShape } from "../../../agentGateway/Services/AgentGatewayCredentials.ts";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { makeClaudeToolTracking } from "./toolTracking";
import { makeClaudeTaskPresentation } from "./taskPresentation";
import type { SDKUserMessage, Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import { makeClaudeSdkStream } from "./sdkStream";
import { makeKeyedLock } from "../../core/keyedLock.ts";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { ProviderAdapterValidationError, ProviderAdapterProcessError } from "../../core/Errors.ts";
import { readClaudeResumeState } from "./sessionResume";
import { type ClaudeTrackedTask } from "../claudeTaskTracker.ts";
import {
  trimOrNull,
  normalizeClaudeModelOptions,
  getDefaultModel,
  getModelCapabilities,
  resolveApiModelId,
  hasEffortLevel,
  getEffectiveClaudeCodeEffort,
} from "@glade/shared/provider/model";
import {
  resolveSelectedClaudeAutoCompactWindow,
  resolveClaudeApiModelIdContextWindowMaxTokens,
} from "../claudeTokenUsage.ts";
import { resolveSelectedClaudeThinkingToggle, toPermissionMode } from "./modelCapabilities";
import {
  buildClaudeSdkSubagents,
  CLAUDE_SETTING_SOURCES,
  buildEmbeddedClaudeSystemPromptAppend,
} from "./promptPolicy";
import { acquireAgentGatewaySessionLease } from "../../../agentGateway/sessionLease.ts";
import { makeClaudeSdkHooks } from "./sdkHooks";
import { withClaudeArtifactOptIn } from "../claudeProcessEnv.ts";
import { buildClaudeMcpServers } from "../../../agentGateway/mcpInjection.ts";
import { toMessage } from "./streamErrors";
import { prestartClaudeMessageStream } from "./sdkProcessRuntime";
import { claudeCacheForModel } from "../claudeCacheObservation.ts";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { ClaudeRequestUsage } from "../claudeRequestUsage.ts";
import { makeClaudeDiscovery } from "./discovery";

export function makeClaudeSessionStartup(input: {
  readonly resolveClaudeStartPreflight: ReturnType<
    typeof makeClaudeSessionAccess
  >["resolveClaudeStartPreflight"];
  readonly nowIso: Effect.Effect<string>;
  readonly failedStartupProcessOwners: Map<ThreadId, ClaudeProcessOwner>;
  readonly teardownFailedStartupProcess: ReturnType<
    typeof makeClaudeProcessOwnership
  >["teardownFailedStartupProcess"];
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
  readonly assertSessionReplaceable: ReturnType<
    typeof makeClaudeSessionAccess
  >["assertSessionReplaceable"];
  readonly stopSessionInternal: ReturnType<typeof makeClaudeSessionTeardown>["stopSessionInternal"];
  readonly agentGatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly cacheClock: Clock.Clock;
  readonly runSdkSync: <A, E>(effect: Effect.Effect<A, E>) => A;
  readonly runSdkFork: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
  readonly emitClaudeCacheObservation: ReturnType<
    typeof makeClaudeRuntimeEvents
  >["emitClaudeCacheObservation"];
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
  readonly settlePendingUserInput: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingUserInput"];
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;
  readonly emitSubagentSteerDelivered: ReturnType<
    typeof makeClaudeToolTracking
  >["emitSubagentSteerDelivered"];
  readonly emitProposedPlanCompleted: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitProposedPlanCompleted"];
  readonly settlePendingApproval: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingApproval"];
  readonly bindClaudeProcessOwner: ReturnType<
    typeof makeClaudeProcessOwnership
  >["bindClaudeProcessOwner"];
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => Promise<ClaudeQueryRuntime>;
  readonly verifyClaudeAutoModelSupport: ReturnType<
    typeof makeClaudeDiscovery
  >["verifyClaudeAutoModelSupport"];
  readonly observeSessionModels: ReturnType<typeof makeClaudeDiscovery>["observeSessionModels"];
  readonly observeSessionAgents: ReturnType<typeof makeClaudeDiscovery>["observeSessionAgents"];
  readonly runSdkStream: ReturnType<typeof makeClaudeSdkStream>["runSdkStream"];
  readonly handleStreamExit: ReturnType<typeof makeClaudeSdkStream>["handleStreamExit"];
  readonly withSessionLifecycleLock: ReturnType<typeof makeKeyedLock<ThreadId>>["withLock"];
}) {
  const {
    resolveClaudeStartPreflight,
    nowIso,
    failedStartupProcessOwners,
    teardownFailedStartupProcess,
    sessions,
    assertSessionReplaceable,
    stopSessionInternal,
    agentGatewayCredentials,
    cacheClock,
    runSdkSync,
    runSdkFork,
    emitClaudeCacheObservation,
    makeEventStamp,
    offerRuntimeEvent,
    settlePendingUserInput,
    runSdkPromise,
    emitSubagentSteerDelivered,
    emitProposedPlanCompleted,
    settlePendingApproval,
    bindClaudeProcessOwner,
    createQuery,
    verifyClaudeAutoModelSupport,
    observeSessionModels,
    observeSessionAgents,
    runSdkStream,
    handleStreamExit,
    withSessionLifecycleLock,
  } = input;
  const startSessionUnlocked = (
    input: Parameters<ClaudeAdapterShape["startSession"]>[0],
    preflight?: Effect.Success<ReturnType<typeof resolveClaudeStartPreflight>>,
  ): ReturnType<ClaudeAdapterShape["startSession"]> =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      const startedAt = yield* nowIso;
      const resumeState = readClaudeResumeState(input.resumeCursor);
      const threadId = input.threadId;
      const existingResumeSessionId = resumeState?.resume;
      const newSessionId =
        existingResumeSessionId === undefined ? yield* Random.nextUUIDv4 : undefined;
      const sessionId = existingResumeSessionId ?? newSessionId;

      const promptQueue = yield* Queue.unbounded<PromptQueueItem>();
      const prompt = Stream.fromQueue(promptQueue).pipe(
        Stream.filter((item) => item.type === "message"),
        Stream.map((item) => item.message),
        Stream.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause),
        ),
        Stream.toAsyncIterable,
      );

      const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
      const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
      const pendingSubagentSteers = new Map<string, Array<string>>();
      const pendingSubagentStops = new Set<string>();
      const inFlightTools = new Map<number, ToolInFlight>();
      const trackedTasks = new Map<string, ClaudeTrackedTask>(
        (resumeState?.trackedTasks ?? []).map((task) => [task.id, task]),
      );

      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

      const providerOptions = input.providerOptions?.claudeAgent;
      const modelSelection =
        input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : undefined;
      const requestedEffort = trimOrNull(modelSelection?.options?.effort ?? null);
      const requestedAutoCompactWindow = normalizeClaudeModelOptions(
        modelSelection?.model,
        modelSelection?.options,
      )?.autoCompactWindow;
      const effectiveClaudeModel = modelSelection?.model ?? getDefaultModel("claudeAgent");
      const caps = getModelCapabilities("claudeAgent", effectiveClaudeModel);
      const requestedAutoCompactWindowTokens = resolveSelectedClaudeAutoCompactWindow(
        effectiveClaudeModel,
        requestedAutoCompactWindow,
      );
      const apiModelId = modelSelection ? resolveApiModelId(modelSelection) : undefined;
      const effort =
        requestedEffort && hasEffortLevel(caps, requestedEffort) ? requestedEffort : null;
      const fastMode = modelSelection?.options?.fastMode === true && caps.supportsFastMode;
      const thinking = resolveSelectedClaudeThinkingToggle(
        effectiveClaudeModel,
        modelSelection?.options?.thinking,
      );
      const effectiveEffort = getEffectiveClaudeCodeEffort(effort);
      const ultracode = effort === "ultracode" && hasEffortLevel(caps, "xhigh");
      const permissionMode =
        input.runtimeMode === "auto"
          ? "auto"
          : (toPermissionMode(providerOptions?.permissionMode) ??
            (input.runtimeMode === "full-access" ? "bypassPermissions" : undefined));
      const settings = {
        // Pin only explicit non-native overrides. Otherwise Claude Code owns resolution via server tuning,
        // settings.json, and CLAUDE_CODE_AUTO_COMPACT_WINDOW.
        autoCompactEnabled: true,
        ...(requestedAutoCompactWindowTokens !== undefined
          ? { autoCompactWindow: requestedAutoCompactWindowTokens }
          : {}),
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),

        ...(effectiveEffort && effectiveEffort !== "max" ? { effortLevel: effectiveEffort } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        ...(ultracode ? { ultracode: true } : {}),
      };
      const claudeSubagents = buildClaudeSdkSubagents();
      const { claudeSdkEnv, snapshotSupported } =
        preflight ?? (yield* resolveClaudeStartPreflight(input));
      const failedStartupProcessOwner = failedStartupProcessOwners.get(threadId);
      if (failedStartupProcessOwner) {
        yield* teardownFailedStartupProcess(threadId, failedStartupProcessOwner);
      }
      const existing = sessions.get(threadId);
      if (existing) {
        yield* assertSessionReplaceable(threadId);

        yield* stopSessionInternal(existing, { emitExitEvent: false });
      }
      const processOwner: ClaudeProcessOwner = {};

      const gatewaySessionLease = acquireAgentGatewaySessionLease(
        agentGatewayCredentials,
        threadId,
        PROVIDER,
        { ...input, nativeToolCallScope: true },
      );
      const {
        sessionStartHook,
        subagentSteerHook,
        canUseTool,
        gatewayToolHook,
        getStartupCacheObservation,
      } = makeClaudeSdkHooks({
        sessionId,
        cacheClock,
        input,
        runSdkSync,
        contextRef,
        resumeState,
        sessions,
        threadId,
        runSdkFork,
        emitClaudeCacheObservation,
        makeEventStamp,
        pendingUserInputs,
        offerRuntimeEvent,
        settlePendingUserInput,
        pendingSubagentSteers,
        runSdkPromise,
        emitSubagentSteerDelivered,
        emitProposedPlanCompleted,
        pendingApprovals,
        settlePendingApproval,
        gatewaySessionLease,
      });

      const queryOptions: ClaudeQueryOptions = {
        ...(input.cwd ? { cwd: input.cwd } : {}),

        ...(apiModelId ? { model: apiModelId } : {}),
        pathToClaudeCodeExecutable: providerOptions?.binaryPath ?? "claude",
        settingSources: [...CLAUDE_SETTING_SOURCES],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildEmbeddedClaudeSystemPromptAppend(
            agentGatewayCredentials !== undefined,
            input.enableComputerControl === true,
          ),

          excludeDynamicSections: true,
          ...(snapshotSupported ? { snapshot: true } : {}),
        },
        ...(Object.keys(claudeSubagents).length > 0 ? { agents: claudeSubagents } : {}),

        ...(effectiveEffort === "max" ? { effort: "max" as const } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(providerOptions?.maxThinkingTokens !== undefined
          ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
          : {}),
        settings,
        ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
        ...(newSessionId ? { sessionId: newSessionId } : {}),
        includePartialMessages: true,

        forwardSubagentText: true,
        hooks: {
          SessionStart: [{ hooks: [sessionStartHook] }],
          PreToolUse: [{ hooks: [subagentSteerHook, gatewayToolHook] }],
        },
        canUseTool,
        env: withClaudeArtifactOptIn(claudeSdkEnv, providerOptions?.enableArtifacts),
        spawnClaudeCodeProcess: bindClaudeProcessOwner(processOwner),
        ...(input.cwd ? { additionalDirectories: [input.cwd] } : {}),
        ...(agentGatewayCredentials
          ? {
              mcpServers: buildClaudeMcpServers(gatewaySessionLease!.connection),
            }
          : {}),
      };

      const queryRuntime = yield* Effect.tryPromise({
        try: () =>
          createQuery({
            prompt,
            options: queryOptions,
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: toMessage(cause, "Failed to start Claude runtime session."),
            cause,
          }),
      }).pipe(
        Effect.tapError(() =>
          Effect.all([
            teardownFailedStartupProcess(threadId, processOwner).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  if (processOwner.process) {
                    failedStartupProcessOwners.set(threadId, processOwner);
                  }
                }).pipe(
                  Effect.andThen(
                    Effect.logWarning("claude.session.failed_start_teardown_unproven", {
                      threadId,
                      detail: error.message,
                    }),
                  ),
                ),
              ),
            ),
            gatewaySessionLease ? Effect.sync(gatewaySessionLease.release) : Effect.void,
          ]).pipe(Effect.asVoid),
        ),
      );
      const messageStream =
        input.runtimeMode === "auto" ? prestartClaudeMessageStream(queryRuntime) : undefined;

      let installationContext: ClaudeSessionContext | undefined;
      let installationComplete = false;

      return yield* Effect.gen(function* () {
        if (input.runtimeMode === "auto") {
          yield* verifyClaudeAutoModelSupport({
            queryRuntime,
            selectedModel: effectiveClaudeModel,
            apiModelId,
            operation: "startSession",
          });
        } else {
          observeSessionModels(queryRuntime);
        }

        observeSessionAgents(queryRuntime);

        const processedTokenBaselineKnown =
          input.resumeCursor === undefined || resumeState?.processedTokenTotal !== undefined;
        const cacheObservation = claudeCacheForModel(
          getStartupCacheObservation() ?? resumeState?.claudeCache,
          apiModelId,
        );
        const initialCacheObservation = cacheObservation
          ? {
              ...cacheObservation,
              ...(input.lifecycleGeneration
                ? { lifecycleGeneration: input.lifecycleGeneration }
                : {}),
            }
          : undefined;
        const session: ProviderSession = {
          threadId,
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(threadId ? { threadId } : {}),
          resumeCursor: {
            ...(initialCacheObservation ? { claudeCache: initialCacheObservation } : {}),
            ...(threadId ? { threadId } : {}),
            ...(sessionId ? { resume: sessionId } : {}),
            ...(resumeState?.resumeSessionAt
              ? { resumeSessionAt: resumeState.resumeSessionAt }
              : {}),
            turnCount: resumeState?.turnCount ?? 0,
            ...(trackedTasks.size > 0 ? { trackedTasks: Array.from(trackedTasks.values()) } : {}),
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
          ...(initialCacheObservation ? { cacheObservation: initialCacheObservation } : {}),
          ...(gatewaySessionLease ? { gatewaySessionLease } : {}),
          session,
          startInput: input,
          artifactsEnabled: providerOptions?.enableArtifacts === true,
          ...(input.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: input.lifecycleGeneration }
            : {}),
          promptQueue,
          query: queryRuntime,
          ...(messageStream ? { messageStream } : {}),
          processOwner,
          streamFiber: undefined,
          startedAt,
          basePermissionMode: permissionMode,
          // A fresh CLI starts in `permissionMode` when queryOptions provides one, otherwise the SDK's
          // "default" mode (queryOptions omits it).
          spawnPermissionMode: permissionMode ?? "default",
          firstTurnSpawnModeAuthoritative: true,
          lastInteractionMode: undefined,
          currentApiModelId: apiModelId,
          resumeSessionId: sessionId,
          pendingApprovals,
          approvalsAlwaysAllowedForSession: false,
          pendingUserInputs,
          turns: [],
          inFlightTools,
          trackedTasks,
          turnState: undefined,
          lastTurnId: undefined,
          interruptRequestedTurnId: undefined,
          lastKnownContextWindow: resolveClaudeApiModelIdContextWindowMaxTokens(
            apiModelId ?? effectiveClaudeModel,
          ),
          currentAutoCompactWindow: requestedAutoCompactWindowTokens,
          currentAlwaysThinkingEnabled: thinking,
          currentEffort: effectiveEffort,
          currentUltracode: ultracode,
          currentFastMode: fastMode,
          lastKnownAutoCompactThreshold: requestedAutoCompactWindowTokens,
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
          rerouteOriginalApiModelId: undefined,
          emittedContextUsageWarnings: new Set(),
          stopped: false,
          warnedUnhandledSdkKinds: new Set(),
          subagentRuns: new Map(),
          pendingSubagentSteers,
          pendingSubagentStops,
          knownBackgroundTaskIds: new Set(),
          terminalTaskIds: new Set(),
          settledSubagentToolUseIds: new Map(),
          liveWorkflowTaskIds: new Set(),
          knownWorkflowTaskIds: new Set(),
          workflowTaskIdByMemberTaskId: new Map(),
          workflowRuntimePollers: new Map(),
          workflowAgentLabels: new Map(),
          workflowRuntimeStates: new Map(),
        };
        installationContext = context;
        yield* Effect.gen(function* () {
          yield* Ref.set(contextRef, context);
          sessions.set(threadId, context);

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
          yield* emitClaudeCacheObservation(context);

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
                autoCompactWindow: requestedAutoCompactWindowTokens ?? null,
                ...(input.cwd ? { cwd: input.cwd } : {}),
                ...(effectiveEffort ? { effort: effectiveEffort } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(providerOptions?.maxThinkingTokens !== undefined
                  ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
                  : {}),
                ...(fastMode ? { fastMode: true } : {}),
                ...(ultracode ? { ultracode: true } : {}),
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

        installationComplete = true;
        return {
          ...context.session,
        };
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            if (installationComplete) {
              return Effect.void;
            }
            if (installationContext !== undefined) {
              return stopSessionInternal(installationContext, {
                emitExitEvent: false,
              }).pipe(Effect.ignore);
            }
            return Effect.gen(function* () {
              gatewaySessionLease?.release();
              yield* Queue.shutdown(promptQueue);
              const closeExit = yield* Effect.exit(Effect.sync(() => queryRuntime.close()));
              if (Exit.isFailure(closeExit)) {
                yield* Effect.logWarning("claude.session.failed_install_cleanup", {
                  threadId,
                  cause: Cause.pretty(closeExit.cause),
                });
              }
              yield* teardownFailedStartupProcess(threadId, processOwner);
            });
          }).pipe(Effect.ignore),
        ),
      );
    });

  const startSession: ClaudeAdapterShape["startSession"] = (input) =>
    withSessionLifecycleLock(input.threadId, startSessionUnlocked(input));
  return { startSessionUnlocked, startSession };
}
