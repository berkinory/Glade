import type { ServerConfigShape } from "../../../server/config.ts";
import { Effect, Duration, Schema } from "effect";
import { makeClaudeProcessOwnership } from "./processOwnership";
import type {
  SDKUserMessage,
  Options as ClaudeQueryOptions,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeQueryRuntime, ClaudeProcessOwner } from "./adapterConfiguration";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
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
import { mapClaudeModelInfo, resolveClaudeAutoModeModel } from "./modelCapabilities";
import { neverResolvingUserMessageStream, CLAUDE_DISCOVERY_THREAD_ID } from "./sdkProcessRuntime";
import { CLAUDE_SETTING_SOURCES } from "./promptPolicy";
import { mapSupportedCommands, resolveClaudeArtifactsState } from "./commandPresentation";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { withClaudeArtifactOptIn } from "../claudeProcessEnv.ts";

export function makeClaudeDiscovery(input: {
  readonly runSdkPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Promise<A>;
  readonly teardownFailedDiscoveryProcesses: ReturnType<
    typeof makeClaudeProcessOwnership
  >["teardownFailedDiscoveryProcesses"];
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => Promise<ClaudeQueryRuntime>;
  readonly bindClaudeProcessOwner: ReturnType<
    typeof makeClaudeProcessOwnership
  >["bindClaudeProcessOwner"];
  readonly teardownDiscoveryProcess: ReturnType<
    typeof makeClaudeProcessOwnership
  >["teardownDiscoveryProcess"];
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
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
  let cachedModels: ProviderListModelsResult | null = null;

  let cachedAgents: ProviderListAgentsResult | null = null;

  const verifyClaudeAutoModelSupport = (input: {
    readonly queryRuntime: ClaudeQueryRuntime;
    readonly selectedModel: string | undefined;
    readonly apiModelId: string | undefined;
    readonly operation: "startSession" | "sendTurn";
  }) =>
    Effect.gen(function* () {
      const requestedModel = input.selectedModel ?? input.apiModelId ?? "selected model";
      const discoveredModels = yield* Effect.tryPromise({
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
      );
      cachedModels = {
        models: discoveredModels.map(mapClaudeModelInfo),
        source: "sdk",
        cached: false,
      };
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

  const observeSessionModels = (queryRuntime: ClaudeQueryRuntime): void => {
    if (!cachedModels) {
      queryRuntime
        .supportedModels()
        .then((models) => {
          cachedModels = {
            models: models.map(mapClaudeModelInfo),
            source: "sdk",
            cached: false,
          };
        })
        .catch(() => {});
    }
  };

  const observeSessionAgents = (queryRuntime: ClaudeQueryRuntime): void => {
    if (!cachedAgents) {
      queryRuntime
        .supportedAgents()
        .then((agents) => {
          cachedAgents = {
            agents: agents.map((a) => ({
              name: a.name,
              displayName: a.name,
              ...(a.description ? { description: a.description } : {}),
              ...(a.model ? { model: a.model } : {}),
            })),
            source: "sdk",
            cached: false,
          };
        })
        .catch(() => {});
    }
  };

  let commandsCache: {
    result: ProviderListCommandsResult;
    cwd: string;
    enableArtifacts: boolean;
  } | null = null;

  const pendingCommandDiscoveries = new Map<string, Promise<ProviderListCommandsResult>>();

  let commandDiscoveryTail: Promise<unknown> = Promise.resolve();

  let pendingModelDiscovery: Promise<ProviderListModelsResult> | null = null;

  async function discoverViaTemporaryProcess<T>(
    cwd: string,
    env: NodeJS.ProcessEnv,
    binaryPath: string,
    discover: (queryRuntime: ClaudeQueryRuntime) => Promise<T>,
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
          permissionMode: "plan" as PermissionMode,
          persistSession: false,
          env,
          spawnClaudeCodeProcess: bindClaudeProcessOwner(processOwner),
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

  const discoverModelsViaTemporaryProcess = (
    cwd: string,
    env: NodeJS.ProcessEnv,
    binaryPath: string,
  ): Promise<ProviderListModelsResult> =>
    discoverViaTemporaryProcess(cwd, env, binaryPath, async (queryRuntime) => ({
      models: (await queryRuntime.supportedModels()).map(mapClaudeModelInfo),
      source: "sdk",
      cached: false,
    }));

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
            : [...sessions.values()].find(
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
      if (cachedModels) {
        return { ...cachedModels, cached: true };
      }

      for (const [, context] of sessions) {
        if (!context.stopped && context.query) {
          const result = yield* Effect.tryPromise({
            try: async () => ({
              models: (await context.query.supportedModels()).map(mapClaudeModelInfo),
              source: "sdk",
              cached: false,
            }),
            catch: (cause) => toRequestError(context.session.threadId, "listModels", cause),
          });
          cachedModels = result;
          return result;
        }
      }

      const claudeSdkEnv = yield* resolveClaudeSdkEnv;
      const discoveryPromise =
        pendingModelDiscovery ??
        discoverModelsViaTemporaryProcess(
          input.cwd ?? serverConfig.cwd,
          claudeSdkEnv,
          input.binaryPath ?? "claude",
        );
      pendingModelDiscovery = discoveryPromise;

      const result = yield* Effect.tryPromise({
        try: () => discoveryPromise,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: CLAUDE_DISCOVERY_THREAD_ID,
            detail: toMessage(cause, "Failed to discover Claude models."),
            cause,
          }),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            pendingModelDiscovery = null;
          }),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            pendingModelDiscovery = null;
          }),
        ),
      );

      cachedModels = result;
      return result;
    });

  const listAgents: NonNullable<ClaudeAdapterShape["listAgents"]> = (_input) =>
    Effect.sync(() => {
      if (cachedAgents) {
        return { ...cachedAgents, cached: true };
      }
      for (const [, context] of sessions) {
        if (!context.stopped && context.query) {
          context.query
            .supportedAgents()
            .then((agents) => {
              cachedAgents = {
                agents: agents.map((a) => ({
                  name: a.name,
                  displayName: a.name,
                  ...(a.description ? { description: a.description } : {}),
                  ...(a.model ? { model: a.model } : {}),
                })),
                source: "sdk",
                cached: false,
              };
            })
            .catch(() => {});
          break;
        }
      }
      return { agents: [], source: "pending", cached: false };
    });

  const listSkills: NonNullable<ClaudeAdapterShape["listSkills"]> = (
    _input: ProviderListSkillsInput,
  ) =>
    Effect.succeed({
      skills: [],
      source: "unsupported",
      cached: false,
    } satisfies ProviderListSkillsResult);

  const composerCapabilities: ProviderComposerCapabilities = {
    provider: PROVIDER,
    supportsSkillMentions: false,
    supportsSkillDiscovery: false,
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
    observeSessionModels,
    observeSessionAgents,
    getComposerCapabilities,
    listCommands,
    listSkills,
    listModels,
    listAgents,
  };
}
