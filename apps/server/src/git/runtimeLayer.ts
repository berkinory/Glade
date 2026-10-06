import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer } from "effect";

import { GitCoreLive } from "./Layers/GitCore";
import { GitHubCliLive } from "./Layers/GitHubCli";
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
import { ServerSettingsLive } from "../settings/serverSettings";

const TextGenerationProvidersLive = Layer.effect(
  TextGenerationProviders,
  Effect.gen(function* () {
    const implementations = {
      codex: yield* CodexTextGeneration,
      claudeAgent: yield* ClaudeTextGeneration,
    } satisfies Partial<Record<ProviderKind, TextGenerationShape>>;
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
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(TextGenerationLayerLive),
);

const GitStatusBroadcasterLayerLive = GitStatusBroadcasterLive.pipe(
  Layer.provide(Layer.mergeAll(GitCoreLive, GitManagerLayerLive)),
);

export const GitLayerLive = Layer.mergeAll(
  GitCoreLive,
  GitHubCliLive,
  GitManagerLayerLive,
  GitStatusBroadcasterLayerLive,
);
