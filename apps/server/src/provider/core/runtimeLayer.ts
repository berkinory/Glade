import { Effect, Layer } from "effect";

import { AgentGatewayCredentialsWithSecretsLive } from "../../agentGateway/Layers/AgentGatewayCredentials";
import { ServerConfig } from "../../server/config";
import { ServerSettingsService } from "../../settings/serverSettings";
import { ProviderValidationError } from "./Errors";
import { makeClaudeAdapterLive } from "../Layers/ClaudeAdapter";
import { makeCodexAdapterLive } from "../Layers/CodexAdapter";
import { makeEventNdjsonLogger } from "../Layers/EventNdjsonLogger";
import { ProviderAdapterRegistryLive } from "../Layers/ProviderAdapterRegistry";
import { ProviderManagementLive } from "../Layers/ProviderManagement.ts";
import { ProviderDiscoveryServiceLive } from "../Layers/ProviderDiscoveryService";
import { makeDurableProviderServiceLive } from "../Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "../Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime";
import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents";

export function makeServerProviderLayer(
  options: {
    readonly agentGatewayCredentialsLayer?: typeof AgentGatewayCredentialsWithSecretsLive;
  } = {},
) {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const { logProviderEvents, providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "native",
        })
      : undefined;
    const canonicalEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "canonical",
        })
      : undefined;
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );

    const agentGatewayCredentialsLayer =
      options.agentGatewayCredentialsLayer ?? AgentGatewayCredentialsWithSecretsLive;
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(agentGatewayCredentialsLayer));
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerServiceLayer = makeDurableProviderServiceLive({
      ...(canonicalEventLogger ? { canonicalEventLogger } : {}),
      providerIsEnabled: (provider) =>
        serverSettings.getSettings.pipe(
          Effect.map((settings) => settings.providers[provider].enabled),
          Effect.mapError(
            (cause) =>
              new ProviderValidationError({
                operation: "ProviderService.startSession",
                issue: "Failed to read provider enablement settings.",
                cause,
              }),
          ),
        ),
    }).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(ProviderRuntimeEventRepositoryLive),
    );
    const providerDiscoveryLayer = ProviderDiscoveryServiceLive.pipe(
      Layer.provide(adapterRegistryLayer),
    );
    return Layer.mergeAll(
      codexAdapterLayer,
      providerServiceLayer,
      providerDiscoveryLayer,
      ProviderManagementLive.pipe(Layer.provide(adapterRegistryLayer)),
      adapterRegistryLayer,
      providerSessionDirectoryLayer,
    );
  }).pipe(Layer.unwrap);
}
