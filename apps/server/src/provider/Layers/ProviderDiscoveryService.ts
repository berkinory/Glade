import {
  type ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListCommandsInput,
  ProviderListModelsInput,
  type ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListMcpServersInput,
  type ProviderListPluginsResult,
  ProviderModelDescriptor,
  ProviderListSkillsInput,
} from "@glade/contracts/provider/providerDiscovery";
import { Effect, Exit, FileSystem, Layer, Option, Queue, Schema, SchemaIssue } from "effect";

import { modelDiscoveryContext } from "../core/modelDiscoveryContext.ts";
import { ServerConfig } from "../../server/config.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { ProviderValidationError } from "../core/Errors.ts";
import type { ProviderDiscoveryError } from "../Services/ProviderDiscoveryService.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import type { ProviderDiscoveryRuntime } from "../Services/ProviderAdapter.ts";
import {
  ProviderDiscoveryService,
  type ProviderDiscoveryServiceShape,
} from "../Services/ProviderDiscoveryService.ts";
import {
  type PersistedModelCatalogEntryInput,
  makeProviderModelDiscoveryCache,
  providerModelDiscoveryCacheKey,
} from "../core/providerModelDiscoveryCache.ts";
import {
  readProviderModelCatalogCache,
  resolveProviderModelCatalogCachePath,
  writeProviderModelCatalogCache,
} from "../core/providerModelCatalogCache.ts";
import { filterDisabledSkills } from "../core/skillsCatalog.ts";
import { expandHomePath } from "../../workspace/homePath";
import { isInstalledProviderPlugin } from "@glade/shared/provider/providerPlugins";

// A project typed as "~/…" (often on an SSH host) reaches discovery before the server canonicalizes
// it; the provider would otherwise look for a folder literally named "~".
function withExpandedCwd<A>(decoded: A): A {
  const cwd = (decoded as { readonly cwd?: unknown }).cwd;
  return typeof cwd === "string" ? { ...decoded, cwd: expandHomePath(cwd) } : decoded;
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.map(withExpandedCwd),
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

const disabledCapabilitiesForProvider = (
  provider: ProviderComposerCapabilities["provider"],
): ProviderComposerCapabilities => ({
  provider,
  supportsSkillMentions: false,
  supportsSkillDiscovery: false,
  supportsNativeSlashCommandDiscovery: false,
  supportsPluginMentions: false,
  supportsPluginDiscovery: false,
  supportsRuntimeModelList: false,
  supportsThreadCompaction: false,
});

const decodeProviderModelDescriptorOption = Schema.decodeUnknownOption(ProviderModelDescriptor);

function keepInstalledPlugins(result: ProviderListPluginsResult): ProviderListPluginsResult {
  return {
    ...result,
    marketplaces: result.marketplaces.flatMap((marketplace) => {
      const plugins = marketplace.plugins.filter(isInstalledProviderPlugin);
      return plugins.length > 0 ? [{ ...marketplace, plugins }] : [];
    }),
  };
}

function isolateMalformedModelDescriptors(input: {
  readonly provider: ProviderListModelsInput["provider"];
  readonly result: ProviderListModelsResult;
}): Effect.Effect<ProviderListModelsResult> {
  const models = input.result.models.flatMap((model) => {
    const decoded = decodeProviderModelDescriptorOption(model);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
  const omittedCount = input.result.models.length - models.length;
  if (omittedCount === 0) {
    return Effect.succeed(input.result);
  }
  return Effect.logWarning("provider model discovery omitted malformed descriptors", {
    provider: input.provider,
    source: input.result.source ?? "unknown",
    omittedCount,
  }).pipe(
    Effect.as({
      ...input.result,
      models,
    }),
  );
}

const make = Effect.gen(function* () {
  const registry = yield* ProviderAdapterRegistry;
  const serverConfig = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;

  const catalogCachePath = resolveProviderModelCatalogCachePath({
    stateDir: serverConfig.stateDir,
  });
  const persistedCatalogs = (yield* readProviderModelCatalogCache(catalogCachePath)).filter(
    // Older catalogs contain synthetic defaults without the metadata needed to select a real model.
    (entry) =>
      !entry.result.models.some(
        (model) => model.slug === "default" || model.slug === "provider-default",
      ),
  );
  // Writes serialize through a queue so concurrent cache mutations can't race the atomic file write.
  const catalogWriteQueue =
    yield* Queue.unbounded<ReadonlyArray<PersistedModelCatalogEntryInput>>();
  const writeCatalogSnapshot = (entries: ReadonlyArray<PersistedModelCatalogEntryInput>) =>
    writeProviderModelCatalogCache({ filePath: catalogCachePath, entries }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to persist provider model catalogs", {
          path: catalogCachePath,
          issues: cause.toString(),
        }),
      ),
    );

  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      let latest: ReadonlyArray<PersistedModelCatalogEntryInput> | undefined;
      for (
        let taken = Queue.takeUnsafe(catalogWriteQueue);
        taken !== undefined;
        taken = Queue.takeUnsafe(catalogWriteQueue)
      ) {
        if (Exit.isSuccess(taken)) latest = taken.value;
      }
      return latest === undefined ? Effect.void : writeCatalogSnapshot(latest);
    }),
  );
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(catalogWriteQueue), (first) => {
        let latest = first;
        for (
          let taken = Queue.takeUnsafe(catalogWriteQueue);
          taken !== undefined;
          taken = Queue.takeUnsafe(catalogWriteQueue)
        ) {
          if (Exit.isSuccess(taken)) latest = taken.value;
        }
        return writeCatalogSnapshot(latest);
      }),
    ),
  );
  const modelDiscoveryCache = makeProviderModelDiscoveryCache<ProviderDiscoveryError>({
    persistedCatalogs,
    onCatalogsChanged: (entries) => {
      Queue.offerUnsafe(catalogWriteQueue, entries);
    },
  });
  const providerIsEnabled = Effect.fn("providerIsEnabled")(function* (
    provider: ProviderGetComposerCapabilitiesInput["provider"],
  ) {
    return yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.providers[provider].enabled),
      Effect.orElseSucceed(() => true),
    );
  });

  const resolveDiscoveryContext = (
    request: ProviderListModelsInput,
    operation: "listModels" | "listSkills" | "listAgents",
  ) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderValidationError({
              operation: `ProviderDiscoveryService.${operation}`,
              issue: "Provider settings are unavailable.",
              cause,
            }),
        ),
      );
      return yield* modelDiscoveryContext({ request, settings, homeDir: serverConfig.homeDir });
    });

  const resolveDiscoveryRuntime = (
    request: ProviderListModelsInput,
    operation: "listSkills" | "listAgents",
  ) =>
    resolveDiscoveryContext(request, operation).pipe(
      Effect.map(
        (context): ProviderDiscoveryRuntime => ({
          binaryPath: context.binaryPath,
          identity: `${context.identity}:${context.workspaceIdentity ?? ""}`,
        }),
      ),
    );

  const getComposerCapabilities: ProviderDiscoveryServiceShape["getComposerCapabilities"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.getComposerCapabilities",
        schema: ProviderGetComposerCapabilitiesInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return disabledCapabilitiesForProvider(parsed.provider);
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      const capabilities = adapter.getComposerCapabilities
        ? yield* adapter.getComposerCapabilities()
        : disabledCapabilitiesForProvider(parsed.provider);

      return {
        ...capabilities,
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
      };
    });

  const listSkills: ProviderDiscoveryServiceShape["listSkills"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listSkills",
        schema: ProviderListSkillsInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return {
          skills: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listSkills) return { skills: [], source: "unsupported", cached: false };
      const runtime = yield* resolveDiscoveryRuntime(
        { provider: parsed.provider, cwd: parsed.cwd },
        "listSkills",
      );
      const nativeResult = yield* adapter.listSkills(parsed, runtime);
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderValidationError({
              operation: "ProviderDiscoveryService.listSkills",
              issue: "Skill enablement settings are unavailable.",
              cause,
            }),
        ),
      );
      return {
        ...nativeResult,
        skills: filterDisabledSkills(nativeResult.skills, settings.skills.disabled),
      };
    });

  const listCommands: ProviderDiscoveryServiceShape["listCommands"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listCommands",
        schema: ProviderListCommandsInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return {
          commands: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listCommands) {
        return {
          commands: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listCommands(parsed);
    });

  const listPlugins: ProviderDiscoveryServiceShape["listPlugins"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listPlugins",
        schema: ProviderListPluginsInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return {
          marketplaces: [],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listPlugins) {
        return {
          marketplaces: [],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
          source: "unsupported",
          cached: false,
        };
      }
      const result = yield* adapter.listPlugins(parsed);
      return parsed.installedOnly ? keepInstalledPlugins(result) : result;
    });

  const listMcpServers: ProviderDiscoveryServiceShape["listMcpServers"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listMcpServers",
        schema: ProviderListMcpServersInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return { servers: [], source: "disabled", cached: false };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listMcpServers) return { servers: [], source: "unsupported", cached: false };
      return yield* adapter.listMcpServers(parsed);
    });

  const listModels: ProviderDiscoveryServiceShape["listModels"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listModels",
        schema: ProviderListModelsInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return {
          models: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listModels) {
        return {
          models: [],
          source: "unsupported",
          cached: false,
        };
      }
      // Chat folders are created on first send, so a draft can ask before its cwd exists. The CLI
      // cannot spawn there, and a missing folder has no project settings, so the global catalog
      // is the right answer.
      const { cwd: requestedCwd, ...workspaceless } = parsed;
      const cwdExists =
        requestedCwd !== undefined &&
        (yield* fileSystem.exists(requestedCwd).pipe(Effect.orElseSucceed(() => false)));
      const scoped: ProviderListModelsInput = cwdExists ? parsed : workspaceless;
      const context = yield* resolveDiscoveryContext(scoped, "listModels");
      const request = { ...scoped, binaryPath: context.binaryPath };
      const listModelsFromAdapter = adapter.listModels;
      const discover = (cwd: string) =>
        Effect.suspend(() => listModelsFromAdapter({ ...request, cwd })).pipe(
          Effect.flatMap((result) =>
            isolateMalformedModelDescriptors({ provider: parsed.provider, result }),
          ),
        );
      const key = {
        ...providerModelDiscoveryCacheKey(request),
        contextIdentity: context.identity,
        workspaceIdentity: context.workspaceIdentity,
      };
      return yield* modelDiscoveryCache.lookup(key, discover(request.cwd ?? serverConfig.homeDir));
    });

  const listAgents: ProviderDiscoveryServiceShape["listAgents"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listAgents",
        schema: ProviderListAgentsInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return {
          agents: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listAgents) {
        return {
          agents: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listAgents(
        parsed,
        yield* resolveDiscoveryRuntime(parsed, "listAgents"),
      );
    });

  return {
    getComposerCapabilities,
    listCommands,
    listMcpServers,
    listSkills,
    listPlugins,
    listModels,
    listAgents,
  } satisfies ProviderDiscoveryServiceShape;
});

export const ProviderDiscoveryServiceLive = Layer.effect(ProviderDiscoveryService, make);
