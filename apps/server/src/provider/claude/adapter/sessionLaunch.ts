import path from "node:path";
import type {
  EffortLevel,
  SDKUserMessage,
  Options as ClaudeQueryOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type { Fiber } from "effect";
import { Effect, Random, Queue, Stream, Cause, Ref, Exit } from "effect";
import type { EventId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import type { ServerSettingsError } from "@glade/contracts/settings/settings";
import type { ClaudeSessionAccessShape } from "../../Services/ClaudeSessionAccess.ts";
import type { ClaudeProcessOwnershipShape } from "../../Services/ClaudeProcessOwnership.ts";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import type { ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { ClaudeProcessOwner, ClaudeQueryRuntime } from "./adapterConfiguration";
import {
  ClaudeSessionContext,
  PROVIDER,
  PromptQueueItem,
  PendingApproval,
  PendingUserInput,
  ToolInFlight,
} from "./sessionTypes";
import { type AgentGatewayCredentialsShape } from "../../../agentGateway/Services/AgentGatewayCredentials.ts";
import { makeClaudeInteractionSettlement } from "./interactionSettlement";
import { ProviderAdapterValidationError, ProviderAdapterProcessError } from "../../core/Errors.ts";
import { readClaudeResumeState } from "./sessionResume";
import { claudeModelOptions, resolveClaudeApiModelId } from "../claudeModelOptions.ts";
import { selectedClaudeModelInfo, toPermissionMode } from "./modelCapabilities";
import { CLAUDE_SETTING_SOURCES, buildEmbeddedClaudeSystemPromptAppend } from "./promptPolicy";
import { acquireAgentGatewaySessionLease } from "../../../agentGateway/sessionLease.ts";
import { canonicalJson } from "../../../agentGateway/creationUtils.ts";
import { makeClaudeSdkHooks } from "./sdkHooks";
import { buildClaudeMcpServers } from "../../../agentGateway/mcpInjection.ts";
import { toMessage } from "./streamErrors";
import { cancellableClaudeMessageStream } from "./sdkProcessRuntime";
import { makeClaudeDiscovery } from "./discovery";
import { createClaudeSkillBridge } from "../claudeSkillBridge.ts";
import type { ServerConfigShape } from "../../../server/config.ts";
import type { WarmLaunch } from "./warmLaunches";

type ClaudeStartInput = Parameters<ClaudeAdapterShape["startSession"]>[0];
type ClaudeStartPreflight = Effect.Success<
  ReturnType<ClaudeSessionAccessShape["resolveClaudeStartPreflight"]>
>;

export interface ClaudeLaunchPlan {
  readonly preflight: ClaudeStartPreflight;
  readonly disabledSkillNames: ReadonlyArray<string>;
  readonly key: string;
}

/** A Claude runtime that finished its initialize handshake but is not yet a registered session. */
export interface ClaudeLaunch extends WarmLaunch {
  readonly existingResumeSessionId: string | undefined;
  readonly resumeState: ReturnType<typeof readClaudeResumeState>;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly pendingSubagentStops: Set<string>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  readonly modelSelection: ClaudeStartInput["modelSelection"];
  readonly apiModelId: string | undefined;
  readonly thinking: boolean | undefined;
  readonly fastMode: boolean | undefined;
  readonly ultracode: boolean | undefined;
  readonly effectiveEffort: string | null;
  readonly permissionMode: NonNullable<ClaudeQueryOptions["permissionMode"]>;
  readonly maxThinkingTokens: number | undefined;
  readonly claudeConfigDir: string | undefined;
  readonly gatewaySessionLease: ReturnType<typeof acquireAgentGatewaySessionLease>;
  readonly skillBridge: Awaited<ReturnType<typeof createClaudeSkillBridge>>;
  readonly queryRuntime: ClaudeQueryRuntime;
  readonly messageStream: ReturnType<typeof cancellableClaudeMessageStream>;
  readonly processOwner: ClaudeProcessOwner;
  readonly initialization: Awaited<ReturnType<ClaudeQueryRuntime["initializationResult"]>>;
}

export function makeClaudeSessionLaunch(input: {
  readonly resolveClaudeStartPreflight: ClaudeSessionAccessShape["resolveClaudeStartPreflight"];
  readonly getDisabledSkillNames: Effect.Effect<ReadonlyArray<string>, ServerSettingsError, never>;
  readonly processOwnership: ClaudeProcessOwnershipShape;
  readonly agentGatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly serverConfig: ServerConfigShape;
  readonly runSdkFork: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly settlePendingUserInput: ReturnType<
    typeof makeClaudeInteractionSettlement
  >["settlePendingUserInput"];
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
}) {
  const {
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
  } = input;

  const planLaunch = (
    input: ClaudeStartInput,
    knownPreflight?: ClaudeStartPreflight,
  ): Effect.Effect<ClaudeLaunchPlan, ProviderAdapterValidationError> =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }
      const preflight = knownPreflight ?? (yield* resolveClaudeStartPreflight(input));
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
      // Everything the spawned process is configured from, except the lifecycle generation, which
      // only the claiming start knows and which never reaches the process.
      const key = canonicalJson({
        cwd: input.cwd,
        modelSelection: input.modelSelection,
        providerOptions: input.providerOptions,
        runtimeMode: input.runtimeMode,
        resumeCursor: input.resumeCursor,
        forkSourceResumeCursor: input.forkSourceResumeCursor,
        binaryPath: preflight.binaryPath,
        env: preflight.claudeSdkEnv,
        snapshotSupported: preflight.snapshotSupported,
        disabledSkillNames,
      });
      return { preflight, disabledSkillNames, key };
    });

  const launch = (input: ClaudeStartInput, plan: ClaudeLaunchPlan) =>
    Effect.gen(function* () {
      const resumeState = readClaudeResumeState(input.resumeCursor);
      const threadId = input.threadId;
      const existingResumeSessionId = resumeState?.resume;
      const newSessionId =
        existingResumeSessionId === undefined ? yield* Random.nextUUIDv4 : undefined;

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

      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

      const providerOptions = input.providerOptions?.claudeAgent;
      const modelSelection =
        input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : undefined;
      const selectedOptions = claudeModelOptions(modelSelection);
      const effectiveClaudeModel = modelSelection?.model ?? "default";
      const apiModelId = modelSelection ? resolveClaudeApiModelId(modelSelection) : undefined;
      const fastMode = selectedOptions.fastMode;
      const thinking = selectedOptions.thinking;
      const effectiveEffort = selectedOptions.effort ?? null;
      const ultracode = selectedOptions.ultracode;
      // Always pass a mode: when omitted, Claude Code starts in the settings'
      // `permissions.defaultMode`, which could silently skip the approvals this mode promises.
      const permissionMode =
        input.runtimeMode === "auto"
          ? "auto"
          : (toPermissionMode(providerOptions?.permissionMode) ??
            (input.runtimeMode === "full-access" ? "bypassPermissions" : "default"));
      const settings = {
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
        ...(fastMode !== undefined ? { fastMode } : {}),
        ...(ultracode !== undefined ? { ultracode } : {}),
      };
      const { claudeSdkEnv, binaryPath, snapshotSupported } = plan.preflight;
      // The CLI keeps session transcripts under CLAUDE_CONFIG_DIR, else under HOME/.claude.
      const claudeConfigDir =
        claudeSdkEnv.CLAUDE_CONFIG_DIR?.trim() ||
        (claudeSdkEnv.HOME ? path.join(claudeSdkEnv.HOME, ".claude") : undefined);
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
            disabledSkillNames: plan.disabledSkillNames,
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
          append: buildEmbeddedClaudeSystemPromptAppend({
            gatewayControlAvailable: agentGatewayCredentials !== undefined,
            computerUseAllowed: input.providerOptions?.allowComputerUse === true,
          }),

          excludeDynamicSections: true,
          ...(snapshotSupported ? { snapshot: true } : {}),
        },

        permissionMode,
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
        env: claudeSdkEnv,
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
      const messageStream = cancellableClaudeMessageStream(queryRuntime, {
        prestart: input.runtimeMode === "auto",
      });

      const release = Effect.gen(function* () {
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
      }).pipe(Effect.ignore);

      const initialization = yield* Effect.gen(function* () {
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
        return initialization;
      }).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : release)));

      return {
        key: plan.key,
        release,
        existingResumeSessionId,
        resumeState,
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
        maxThinkingTokens: providerOptions?.maxThinkingTokens,
        claudeConfigDir,
        gatewaySessionLease,
        skillBridge,
        queryRuntime,
        messageStream,
        processOwner,
        initialization,
      } satisfies ClaudeLaunch;
    });

  return { planLaunch, launch };
}
