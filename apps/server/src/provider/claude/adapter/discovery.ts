import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import type { ServerConfigShape } from "../../../server/config.ts";
import { Effect, Duration, Schema } from "effect";
import type { ClaudeProcessOwnershipShape } from "../../Services/ClaudeProcessOwnership.ts";
import type {
  SDKUserMessage,
  ModelInfo,
  Options as ClaudeQueryOptions,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeQueryRuntime, ClaudeProcessOwner } from "./adapterConfiguration";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER } from "./sessionTypes";
import {
  type ProviderListModelsResult,
  type ProviderListAgentsResult,
  type ProviderListCommandsResult,
  type ProviderListCommandsInput,
  type ProviderListSkillsInput,
  type ProviderListSkillsResult,
  type ProviderComposerCapabilities,
} from "@glade/contracts/provider/providerDiscovery";
import { ProviderAdapterValidationError, ProviderAdapterProcessError } from "../../core/Errors.ts";
import { toMessage, toRequestError } from "./streamErrors";
import { mapClaudeModelCatalog, resolveClaudeAutoModeModel } from "./modelCapabilities";
import { neverResolvingUserMessageStream, CLAUDE_DISCOVERY_THREAD_ID } from "./sdkProcessRuntime";
import { CLAUDE_SETTING_SOURCES } from "./promptPolicy";
import { mapSupportedCommands, resolveClaudeArtifactsState } from "./commandPresentation";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { withClaudeArtifactOptIn } from "../claudeProcessEnv.ts";
import { createClaudeSkillBridge, isSharedClaudeSkill } from "../claudeSkillBridge.ts";
import { discoverSkillsCatalog } from "../../core/skillsCatalog.ts";
import type { ProviderSkillDescriptor } from "@glade/contracts/provider/providerDiscovery";

export function makeClaudeDiscovery(input: {
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;
  readonly teardownFailedDiscoveryProcesses: ClaudeProcessOwnershipShape["teardownFailedDiscoveryProcesses"];
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => Promise<ClaudeQueryRuntime>;
  readonly bindClaudeProcessOwner: ClaudeProcessOwnershipShape["bindClaudeProcessOwner"];
  readonly teardownDiscoveryProcess: ClaudeProcessOwnershipShape["teardownDiscoveryProcess"];
  readonly sessions: ClaudeSessionRegistryShape;
  readonly resolveClaudeSdkEnv: Effect.Effect<NodeJS.ProcessEnv>;
  readonly serverConfig: ServerConfigShape;
}) {
  const {
    runSdkPromise,
    teardownFailedDiscoveryProcesses,
    createQuery,
    bindClaudeProcessOwner,
    teardownDiscoveryProcess,
    sessions,
    resolveClaudeSdkEnv,
    serverConfig,
  } = input;

  const verifyClaudeAutoModelSupport = (input: {
    readonly queryRuntime: ClaudeQueryRuntime;
    readonly discoveredModels?: ReadonlyArray<ModelInfo>;
    readonly selectedModel: string | undefined;
    readonly apiModelId: string | undefined;
    readonly operation: "startSession" | "sendTurn";
  }) =>
    Effect.gen(function* () {
      if (input.apiModelId === undefined) return;
      const requestedModel = input.selectedModel ?? input.apiModelId ?? "selected model";
      const discoveredModels =
        input.discoveredModels ??
        (yield* Effect.tryPromise({
          try: () => input.queryRuntime.supportedModels(),
          catch: (cause) =>
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: input.operation,
              issue:
                `Claude model capability discovery failed while verifying Auto mode support for "${requestedModel}": ` +
                toMessage(cause, "unknown discovery error"),
            }),
        }).pipe(
          Effect.timeout(Duration.seconds(input.operation === "startSession" ? 55 : 5)),
          Effect.mapError((cause) =>
            Schema.is(ProviderAdapterValidationError)(cause)
              ? cause
              : new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation: input.operation,
                  issue: `Could not verify that Claude model "${requestedModel}" supports Auto mode before the model discovery timeout.`,
                }),
          ),
        ));
      const requestedModels = new Set(
        [input.selectedModel, input.apiModelId].filter(
          (model): model is string => model !== undefined,
        ),
      );
      const resolution = resolveClaudeAutoModeModel(discoveredModels, requestedModels);
      if (resolution.status === "absent") {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: input.operation,
          issue: `Claude model "${requestedModel}" was not returned by Claude model discovery, so Auto mode support cannot be verified.`,
        });
      }
      if (resolution.status === "conflicting") {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: input.operation,
          issue: `Claude model "${requestedModel}" has conflicting Auto mode capability metadata across context-window variants.`,
        });
      }
      if (resolution.model.supportsAutoMode !== true) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: input.operation,
          issue: `Claude model "${resolution.model.displayName}" does not support Auto mode.`,
        });
      }
    });

  let commandsCache: {
    result: ProviderListCommandsResult;
    cwd: string;
    enableArtifacts: boolean;
  } | null = null;

  const pendingCommandDiscoveries = new Map<string, Promise<ProviderListCommandsResult>>();

  let commandDiscoveryTail: Promise<unknown> = Promise.resolve();

  async function discoverViaTemporaryProcess<T>(
    cwd: string,
    env: NodeJS.ProcessEnv,
    binaryPath: string,
    discover: (queryRuntime: ClaudeQueryRuntime) => Promise<T>,
    extraOptions?: Pick<ClaudeQueryOptions, "plugins" | "skills" | "model">,
  ): Promise<T> {
    // Never spawn another discovery process until every previously unproven process tree has been
    // reaped successfully.
    await runSdkPromise(teardownFailedDiscoveryProcesses());

    const processOwner: ClaudeProcessOwner = {};
    let tempQuery: ClaudeQueryRuntime | undefined;

    try {
      tempQuery = await createQuery({
        prompt: neverResolvingUserMessageStream(),
        options: {
          cwd,
          pathToClaudeCodeExecutable: binaryPath,
          settingSources: [...CLAUDE_SETTING_SOURCES],
          permissionMode: "default" as PermissionMode,
          persistSession: false,
          env,
          spawnClaudeCodeProcess: bindClaudeProcessOwner(processOwner),
          ...extraOptions,
        },
      });
      const queryRuntime = tempQuery;

      void (async () => {
        for await (const message of queryRuntime) {
          void message;
        }
      })().catch(() => undefined);

      return await discover(queryRuntime);
    } finally {
      try {
        tempQuery?.close();
      } finally {
        await runSdkPromise(teardownDiscoveryProcess(processOwner));
      }
    }
  }

  const discoverCommandsViaTemporaryProcess = (
    cwd: string,
    env: NodeJS.ProcessEnv,
    binaryPath: string,
    artifactsEnabled: boolean,
  ): Promise<ProviderListCommandsResult> =>
    discoverViaTemporaryProcess(cwd, env, binaryPath, (queryRuntime) =>
      queryRuntime
        .supportedCommands()
        .then((commands) =>
          mapSupportedCommands(
            commands,
            resolveClaudeArtifactsState({ artifactsEnabled, commands }),
          ),
        ),
    );

  const readAppliedEffort = async (queryRuntime: ClaudeQueryRuntime) =>
    Schema.decodeUnknownSync(
      Schema.Struct({
        applied: Schema.Struct({ model: Schema.String, effort: Schema.NullOr(Schema.String) }),
      }),
    )(await queryRuntime.getSettings()).applied;

  const discoverModelsViaTemporaryProcess = async (
    cwd: string,
    env: NodeJS.ProcessEnv,
    binaryPath: string,
  ): Promise<ProviderListModelsResult> => {
    const { models, applied } = await discoverViaTemporaryProcess(
      cwd,
      env,
      binaryPath,
      async (queryRuntime) => ({
        models: (await queryRuntime.initializationResult()).models,
        applied: await readAppliedEffort(queryRuntime),
      }),
    );
    const defaultEffortByModel: Record<string, string | null> = { [applied.model]: applied.effort };
    for (const model of models) {
      if (!model.supportsEffort) continue;
      const resolvedModel = model.resolvedModel ?? model.value;
      if (!(resolvedModel in defaultEffortByModel)) {
        // setModel validates account access; startup discovery can inspect effort without a paid request.
        const modelSettings = await discoverViaTemporaryProcess(
          cwd,
          env,
          binaryPath,
          readAppliedEffort,
          { model: resolvedModel },
        );
        defaultEffortByModel[resolvedModel] = modelSettings.effort;
      }
      defaultEffortByModel[model.value] = defaultEffortByModel[resolvedModel]!;
    }
    return {
      models: mapClaudeModelCatalog(models, defaultEffortByModel),
      source: "sdk",
      cached: false,
    };
  };

  const listCommands: NonNullable<ClaudeAdapterShape["listCommands"]> = (
    input: ProviderListCommandsInput,
  ) =>
    Effect.gen(function* () {
      const enableArtifacts = input.enableArtifacts === true;

      const ownContext = input.threadId
        ? sessions.get(ThreadId.makeUnsafe(input.threadId))
        : undefined;
      const context =
        ownContext && !ownContext.stopped
          ? ownContext
          : input.threadId
            ? undefined
            : [...sessions.list()].find(
                (s) => !s.stopped && s.artifactsEnabled === enableArtifacts,
              );

      if (context && !context.stopped) {
        const commands = yield* Effect.tryPromise({
          try: () => context.query.supportedCommands(),
          catch: (cause) => toRequestError(context.session.threadId, "listCommands", cause),
        });
        const result = mapSupportedCommands(
          commands,
          resolveClaudeArtifactsState({
            artifactsEnabled: context.artifactsEnabled,
            commands,
            initToolNames: context.initToolNames,
          }),
        );
        // Cache under the flag this process was spawned with, not the current setting, so a pre-toggle
        // session cannot poison fresh discovery.
        commandsCache = { result, cwd: input.cwd, enableArtifacts: context.artifactsEnabled };
        return result;
      }

      if (
        commandsCache &&
        commandsCache.cwd === input.cwd &&
        commandsCache.enableArtifacts === enableArtifacts &&
        !input.forceReload
      ) {
        return { ...commandsCache.result, cached: true } satisfies ProviderListCommandsResult;
      }

      const claudeSdkEnv = yield* resolveClaudeSdkEnv;
      const binaryPath = input.binaryPath ?? "claude";
      const discoveryKey = JSON.stringify([input.cwd, binaryPath, enableArtifacts]);
      let discoveryPromise = pendingCommandDiscoveries.get(discoveryKey);
      if (!discoveryPromise) {
        const previous = commandDiscoveryTail;
        const started = previous
          .catch(() => undefined)
          .then(() =>
            discoverCommandsViaTemporaryProcess(
              input.cwd,
              withClaudeArtifactOptIn(claudeSdkEnv, enableArtifacts),
              binaryPath,
              enableArtifacts,
            ),
          );
        discoveryPromise = started;
        commandDiscoveryTail = started;
        pendingCommandDiscoveries.set(discoveryKey, started);
        const forget = () => {
          if (pendingCommandDiscoveries.get(discoveryKey) === started) {
            pendingCommandDiscoveries.delete(discoveryKey);
          }
        };
        void started.then(forget, forget);
      }
      const pendingDiscovery = discoveryPromise;

      const result = yield* Effect.tryPromise({
        try: () => pendingDiscovery,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: ThreadId.makeUnsafe("discovery"),
            detail: toMessage(cause, "Failed to discover Claude commands."),
            cause,
          }),
      });

      commandsCache = { result, cwd: input.cwd, enableArtifacts };
      return result;
    });

  const listModels: NonNullable<ClaudeAdapterShape["listModels"]> = (input) =>
    Effect.gen(function* () {
      const claudeSdkEnv = yield* resolveClaudeSdkEnv;
      const discoveryPromise = discoverModelsViaTemporaryProcess(
        input.cwd ?? serverConfig.cwd,
        claudeSdkEnv,
        input.binaryPath ?? "claude",
      );

      const result = yield* Effect.tryPromise({
        try: () => discoveryPromise,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: CLAUDE_DISCOVERY_THREAD_ID,
            detail: toMessage(cause, "Failed to discover Claude models."),
            cause,
          }),
      });

      return result;
    });

  const listAgents: NonNullable<ClaudeAdapterShape["listAgents"]> = (request) =>
    Effect.gen(function* () {
      const cwd = request.cwd ?? serverConfig.cwd;
      const context = sessions
        .list()
        .find((candidate) => !candidate.stopped && candidate.startInput.cwd === cwd);
      const env = yield* resolveClaudeSdkEnv;
      const agents = yield* Effect.tryPromise({
        try: () =>
          context
            ? context.query.supportedAgents()
            : discoverViaTemporaryProcess(cwd, env, request.binaryPath ?? "claude", (query) =>
                query.supportedAgents(),
              ),
        catch: (cause) =>
          toRequestError(
            context?.session.threadId ?? CLAUDE_DISCOVERY_THREAD_ID,
            "listAgents",
            cause,
          ),
      });
      return {
        agents: agents.map((agent) => ({
          name: agent.name,
          displayName: agent.name,
          ...(agent.description ? { description: agent.description } : {}),
          ...(agent.model ? { model: agent.model } : {}),
        })),
        source: "sdk",
        cached: false,
      } satisfies ProviderListAgentsResult;
    });

  const listSkills: NonNullable<ClaudeAdapterShape["listSkills"]> = (
    request: ProviderListSkillsInput,
  ) =>
    Effect.gen(function* () {
      const catalog = yield* Effect.tryPromise({
        try: () =>
          discoverSkillsCatalog({
            cwd: request.cwd,
            homeDir: serverConfig.homeDir,
            gladeBaseDir: serverConfig.baseDir,
            provider: PROVIDER,
            includeDuplicateOrigins: true,
            ...(request.forceReload !== undefined ? { forceReload: request.forceReload } : {}),
          }),
        catch: (cause) => toRequestError(CLAUDE_DISCOVERY_THREAD_ID, "listSkills", cause),
      });
      const session = request.threadId
        ? sessions.get(ThreadId.makeUnsafe(request.threadId))
        : [...sessions.list()].find(
            (candidate) => !candidate.stopped && candidate.startInput.cwd === request.cwd,
          );
      let names: ReadonlySet<string>;
      if (session && !session.stopped) {
        const commands = yield* Effect.tryPromise({
          try: () => session.query.supportedCommands(),
          catch: (cause) => toRequestError(session.session.threadId, "listSkills", cause),
        });
        names = session.initSkillNames ?? new Set(commands.map((command) => command.name));
      } else {
        const bridge = yield* Effect.tryPromise({
          try: () =>
            createClaudeSkillBridge({
              cwd: request.cwd,
              homeDir: serverConfig.homeDir,
              baseDir: serverConfig.baseDir,
              stateDir: serverConfig.stateDir,
            }),
          catch: (cause) => toRequestError(CLAUDE_DISCOVERY_THREAD_ID, "listSkills", cause),
        });
        const env = yield* resolveClaudeSdkEnv;
        names = yield* Effect.tryPromise({
          try: () =>
            discoverViaTemporaryProcess(
              request.cwd,
              env,
              "claude",
              async (query) =>
                new Set((await query.supportedCommands()).map((command) => command.name)),
              {
                ...(bridge.plugin ? { plugins: [bridge.plugin] } : {}),
                skills: [...bridge.enabledSkills],
              },
            ),
          catch: (cause) => toRequestError(CLAUDE_DISCOVERY_THREAD_ID, "listSkills", cause),
        }).pipe(Effect.ensuring(Effect.promise(bridge.cleanup)));
      }
      const skills: ProviderSkillDescriptor[] = [];
      const seen = new Set<string>();
      for (const skill of catalog) {
        const shared = isSharedClaudeSkill(skill.path, serverConfig.baseDir);
        const candidates = shared ? [`glade-shared-skills:${skill.name}`] : [skill.name];
        const nativeName = candidates.find((name) => names.has(name));
        if (!nativeName || seen.has(nativeName.toLowerCase())) continue;
        seen.add(nativeName.toLowerCase());
        skills.push({ ...skill, name: nativeName });
      }
      return { skills, source: "sdk", cached: false } satisfies ProviderListSkillsResult;
    });

  const composerCapabilities: ProviderComposerCapabilities = {
    provider: PROVIDER,
    supportsSkillMentions: true,
    supportsSkillDiscovery: true,
    supportsNativeSlashCommandDiscovery: true,
    supportsPluginMentions: false,
    supportsPluginDiscovery: false,
    supportsRuntimeModelList: true,
    supportsThreadCompaction: false,
    supportsThreadImport: true,
  };

  const getComposerCapabilities: NonNullable<ClaudeAdapterShape["getComposerCapabilities"]> = () =>
    Effect.succeed(composerCapabilities);
  return {
    verifyClaudeAutoModelSupport,
    getComposerCapabilities,
    listCommands,
    listSkills,
    listModels,
    listAgents,
  };
}
