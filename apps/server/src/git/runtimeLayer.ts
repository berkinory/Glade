import { Layer } from "effect";

import { GitCoreLive } from "./Layers/GitCore";
import { GitHubCliLive } from "./Layers/GitHubCli";
import { GitManagerLive } from "./Layers/GitManager";
import { GitStatusBroadcasterLive } from "./Layers/GitStatusBroadcaster";
import { CodexTextGenerationServiceLive } from "./Layers/CodexTextGeneration";
import { ProviderTextGenerationLive } from "./Layers/ProviderTextGeneration";
import { ServerSettingsLive } from "../settings/serverSettings";

export const TextGenerationLayerLive = ProviderTextGenerationLive.pipe(
  Layer.provide(CodexTextGenerationServiceLive),
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
