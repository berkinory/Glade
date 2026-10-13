import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect, FileSystem, Layer } from "effect";

import { GitCoreLive } from "./Layers/GitCore";
import { GitHubLive } from "./Layers/GitHub";
import { GitManagerLive } from "./Layers/GitManager";
import { GitStatusBroadcasterLive } from "./Layers/GitStatusBroadcaster";
import { CodexTextGenerationServiceLive } from "./Layers/CodexTextGeneration";
import { ClaudeTextGenerationServiceLive } from "./Layers/ClaudeTextGeneration";
import { ProviderTextGenerationLive } from "./Layers/ProviderTextGeneration";
import {
  ClaudeTextGeneration,
  CodexTextGeneration,
  TextGenerationProviders,
  type TextGenerationShape,
} from "./Services/TextGeneration";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry";
import { ServerSettingsLive } from "../settings/serverSettings";
import { makeAdapterTextGeneration } from "./adapterTextGeneration";

const TextGenerationProvidersLive = Layer.effect(
  TextGenerationProviders,
  Effect.gen(function* () {
    // Providers without their own Git writing run it on their adapter's structured requests;
    // providers with neither have no entry, and callers report them as unsupported.
    const implementations: Partial<Record<ProviderKind, TextGenerationShape>> = {
      codex: yield* CodexTextGeneration,
      claudeAgent: yield* ClaudeTextGeneration,
    };
    const registry = yield* ProviderAdapterRegistry;
    const fileSystem = yield* FileSystem.FileSystem;
    for (const provider of yield* registry.listProviders()) {
      if (implementations[provider]) continue;
      const adapter = yield* registry.getByProvider(provider);
      if (adapter.structuredRequest) {
        implementations[provider] = makeAdapterTextGeneration({
          provider,
          fileSystem,
          structuredRequest: adapter.structuredRequest,
        });
      }
    }
    return {
      get: (provider: ProviderKind) => implementations[provider],
      listProviders: () => Object.keys(implementations) as ProviderKind[],
    };
  }),
).pipe(
  Layer.provideMerge(CodexTextGenerationServiceLive),
  Layer.provideMerge(ClaudeTextGenerationServiceLive),
);

export const TextGenerationLayerLive = ProviderTextGenerationLive.pipe(
  Layer.provideMerge(TextGenerationProvidersLive),
  Layer.provide(ServerSettingsLive),
);

const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubLive),
  Layer.provideMerge(TextGenerationLayerLive),
);

const GitStatusBroadcasterLayerLive = GitStatusBroadcasterLive.pipe(
  Layer.provide(Layer.mergeAll(GitCoreLive, GitManagerLayerLive)),
);

export const GitLayerLive = Layer.mergeAll(
  GitCoreLive,
  GitHubLive,
  GitManagerLayerLive,
  GitStatusBroadcasterLayerLive,
);
