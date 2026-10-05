import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import type { Fiber } from "effect";
import type { ClaudeSessionAccessShape } from "../../Services/ClaudeSessionAccess.ts";
import { Effect, Random, Queue, Stream, Cause, Ref, Exit } from "effect";
import { ThreadId, EventId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { ClaudeProcessOwner, ClaudeQueryRuntime } from "./adapterConfiguration";
import type { ClaudeProcessOwnershipShape } from "../../Services/ClaudeProcessOwnership.ts";
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
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";

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
  resolveApiModelId,
  getEffectiveClaudeCodeEffort,
} from "@glade/shared/provider/model";
import { selectedClaudeModelInfo, toPermissionMode } from "./modelCapabilities";
import { CLAUDE_SETTING_SOURCES, buildEmbeddedClaudeSystemPromptAppend } from "./promptPolicy";
import { acquireAgentGatewaySessionLease } from "../../../agentGateway/sessionLease.ts";
import { makeClaudeSdkHooks } from "./sdkHooks";
import { withClaudeArtifactOptIn } from "../claudeProcessEnv.ts";
import { buildClaudeMcpServers } from "../../../agentGateway/mcpInjection.ts";
import { toMessage } from "./streamErrors";
import { prestartClaudeMessageStream } from "./sdkProcessRuntime";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { ClaudeRequestUsage } from "../claudeRequestUsage.ts";
import { makeClaudeDiscovery } from "./discovery";
import { createClaudeSkillBridge } from "../claudeSkillBridge.ts";
import type { ServerConfigShape } from "../../../server/config.ts";
import type { ServerSettingsError } from "@glade/contracts/settings/settings";

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
      const pendingSubagentStops = new Set<string>();
      const inFlightTools = new Map<number, ToolInFlight>();
      const trackedTasks = new Map<string, ClaudeTrackedTask>(
        (resumeState?.trackedTasks ?? []).map((task) => [task.id, task]),
      );

      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

      const providerOptions = input.providerOptions?.claudeAgent;
      const modelSelection =
        input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : undefined;
      const selectedOptions = normalizeClaudeModelOptions(
        modelSelection?.model,
        modelSelection?.options,
      );
      const requestedEffort = trimOrNull(selectedOptions?.effort ?? null);
      const effectiveClaudeModel = modelSelection?.model ?? "default";
      const apiModelId = modelSelection ? resolveApiModelId(modelSelection) : undefined;
      const fastMode = selectedOptions?.fastMode;
      const thinking = selectedOptions?.thinking;
      const effectiveEffort = getEffectiveClaudeCodeEffort(requestedEffort);
      const ultracode = selectedOptions?.ultracode;
      const permissionMode =
        input.runtimeMode === "auto"
          ? "auto"
          : (toPermissionMode(providerOptions?.permissionMode) ??
            (input.runtimeMode === "full-access" ? "bypassPermissions" : undefined));
      const settings = {
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
        ...(fastMode !== undefined ? { fastMode } : {}),
        ...(ultracode !== undefined ? { ultracode } : {}),
      };
      const { claudeSdkEnv, binaryPath, snapshotSupported } =
        preflight ?? (yield* resolveClaudeStartPreflight(input));
      const disabledSkillNames = yield* getDisabledSkillNames.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "Skill settings are unavailable.",
              cause,
            }),
        ),
      );
      const failedStartupProcessOwner = processOwnership.failedStartupOwner(threadId);
      if (failedStartupProcessOwner) {
        yield* processOwnership.teardownFailedStartupProcess(threadId, failedStartupProcessOwner);
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
      const { canUseTool, onElicitation, gatewayToolHook } = makeClaudeSdkHooks({
        input,
        contextRef,
        runSdkFork,
        makeEventStamp,
        pendingUserInputs,
        offerRuntimeEvent,
        settlePendingUserInput,
        runSdkPromise,

        pendingApprovals,
        settlePendingApproval,
        gatewaySessionLease,
        getDisabledSkillNames,
      });
      const skillBridge = yield* Effect.tryPromise({
        try: () =>
          createClaudeSkillBridge({
            cwd: input.cwd ?? serverConfig.cwd,
            homeDir: serverConfig.homeDir,
            baseDir: serverConfig.baseDir,
            stateDir: serverConfig.stateDir,
            disabledSkillNames,
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: toMessage(cause, "Failed to prepare Claude skills."),
            cause,
          }),
      }).pipe(
        Effect.tapError(() =>
          gatewaySessionLease ? Effect.sync(gatewaySessionLease.release) : Effect.void,
        ),
      );

      const queryOptions: ClaudeQueryOptions = {
        ...(input.cwd ? { cwd: input.cwd } : {}),

        ...(apiModelId ? { model: apiModelId } : {}),
        pathToClaudeCodeExecutable: binaryPath,
        settingSources: [...CLAUDE_SETTING_SOURCES],
        ...(skillBridge.plugin ? { plugins: [skillBridge.plugin] } : {}),
        skills: [...skillBridge.enabledSkills],
        // The live catalog is authoritative; SDK effort typings can lag native levels.
        ...(effectiveEffort ? { effort: effectiveEffort as EffortLevel } : {}),
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
          PreToolUse: [{ hooks: [gatewayToolHook] }],
        },
        canUseTool,
        onElicitation,
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
            processOwnership.teardownFailedStartupProcess(threadId, processOwner).pipe(
              Effect.catch((error) =>
                processOwnership.rememberFailedStartupOwner(threadId, processOwner).pipe(
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
            Effect.promise(skillBridge.cleanup),
          ]).pipe(Effect.asVoid),
        ),
      );
      const messageStream =
        input.runtimeMode === "auto" ? prestartClaudeMessageStream(queryRuntime) : undefined;

      let installationContext: ClaudeSessionContext | undefined;
      let installationComplete = false;

      return yield* Effect.gen(function* () {
        const initialization = yield* Effect.tryPromise({
          try: () => queryRuntime.initializationResult(),
          catch: (cause) =>
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Claude initialization failed: ${toMessage(cause, "unknown SDK error")}`,
            }),
        });
        if (input.runtimeMode === "auto") {
          yield* verifyClaudeAutoModelSupport({
            queryRuntime,
            discoveredModels: initialization.models,
            selectedModel: effectiveClaudeModel,
            apiModelId,
            operation: "startSession",
          });
        }
        const selectedModelInfo = selectedClaudeModelInfo(
          initialization.models,
          effectiveClaudeModel,
        );
        if (selectedModelInfo) {
          if (
            effectiveEffort &&
            !selectedModelInfo.supportedEffortLevels?.some((level) => level === effectiveEffort)
          ) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Claude model "${selectedModelInfo.displayName}" does not support ${effectiveEffort} effort.`,
            });
          }
          if (ultracode && !selectedModelInfo.supportedEffortLevels?.includes("xhigh")) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Claude model "${selectedModelInfo.displayName}" does not support Ultracode.`,
            });
          }
          if (fastMode && selectedModelInfo.supportsFastMode !== true) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Claude model "${selectedModelInfo.displayName}" does not support fast mode.`,
            });
          }
        }

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
          skillBridgeCleanup: skillBridge.cleanup,
          allowedSkillNames: new Set(skillBridge.enabledSkills),
          basePermissionMode: permissionMode,
          // A fresh CLI starts in `permissionMode` when queryOptions provides one, otherwise the SDK's
          // "default" mode (queryOptions omits it).
          spawnPermissionMode: permissionMode ?? "default",
          firstTurnSpawnModeAuthoritative: true,

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
          availableModels: initialization.models,
          fastModeState: initialization.fast_mode_state,
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
              yield* processOwnership.teardownFailedStartupProcess(threadId, processOwner);
              yield* Effect.promise(skillBridge.cleanup);
            });
          }).pipe(Effect.ignore),
        ),
      );
    });

  const startSession: ClaudeAdapterShape["startSession"] = (input) =>
    withSessionLifecycleLock(input.threadId, startSessionUnlocked(input));
  return { startSessionUnlocked, startSession };
}
