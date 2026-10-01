import { DEFAULT_SERVER_SETTINGS } from "@glade/contracts/settings/settings";
import {
  type ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListCommandsInput,
  ProviderListModelsInput,
  type ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderModelDescriptor,
  ProviderListSkillsInput,
  ProviderReadPluginInput,
} from "@glade/contracts/provider/providerDiscovery";
import { Effect, Exit, Layer, Option, Queue, Schema, SchemaIssue } from "effect";

import { modelDiscoveryContext } from "../core/modelDiscoveryContext.ts";
import { ServerConfig } from "../../server/config.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { ProviderValidationError } from "../core/Errors.ts";
import type { ProviderDiscoveryError } from "../Services/ProviderDiscoveryService.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
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

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
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
  supportsThreadImport: false,
});

const decodeProviderModelDescriptorOption = Schema.decodeUnknownOption(ProviderModelDescriptor);

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
      const nativeResult = yield* adapter.listSkills(parsed);
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
      if (parsed.provider !== "claudeAgent") {
        return yield* adapter.listCommands(parsed);
      }

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
      );
      return yield* adapter.listCommands({
        ...parsed,
        enableArtifacts: settings.providers.claudeAgent.enableArtifacts,
      });
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
      return yield* adapter.listPlugins(parsed);
    });

  const readPlugin: ProviderDiscoveryServiceShape["readPlugin"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.readPlugin",
        schema: ProviderReadPluginInput,
        payload: input,
      });
      if (!(yield* providerIsEnabled(parsed.provider))) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.readPlugin",
          issue: `Provider '${parsed.provider}' is disabled in Glade settings.`,
        });
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.readPlugin) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.readPlugin",
          issue: `Plugin discovery is unavailable for provider '${parsed.provider}'.`,
        });
      }
      return yield* adapter.readPlugin(parsed);
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
      const context = yield* modelDiscoveryContext({
        request: parsed,
        settings: yield* serverSettings.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new ProviderValidationError({
                operation: "ProviderDiscoveryService.listModels",
                issue: "Provider settings are unavailable.",
                cause,
              }),
          ),
        ),
        homeDir: serverConfig.homeDir,
      });
      const request = { ...parsed, binaryPath: context.binaryPath };
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
      const global = yield* modelDiscoveryCache.lookup(
        { ...key, cwd: null, workspaceIdentity: null },
        discover(serverConfig.homeDir),
      );
      if (!request.cwd) return global;
      return yield* modelDiscoveryCache.lookup(key, discover(request.cwd));
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
      return yield* adapter.listAgents(parsed);
    });

  return {
    getComposerCapabilities,
    listCommands,
    listSkills,
    listPlugins,
    readPlugin,
    listModels,
    listAgents,
  } satisfies ProviderDiscoveryServiceShape;
});

export const ProviderDiscoveryServiceLive = Layer.effect(ProviderDiscoveryService, make);
