import { type ModelSlug, type ProviderModelOptions } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import {
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  normalizeClaudeModelOptions,
} from "@glade/shared/provider/model";
import { getRuntimeAwareModelCapabilities } from "./runtimeModelCapabilities";

export type ComposerProviderStateInput = {
  provider: ProviderKind;
  model: ModelSlug;
  runtimeModel?: ProviderModelDescriptor | undefined;
  prompt: string;
  modelOptions: ProviderModelOptions | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ProviderModelOptions[ProviderKind] | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const options = input.modelOptions?.[input.provider];
  const effortId = input.provider === "claudeAgent" ? "effort" : "reasoningEffort";
  const descriptors = getProviderOptionDescriptors({
    provider: input.provider,
    caps: getRuntimeAwareModelCapabilities(input),
    selections: options,
  });
  const effort = getProviderOptionCurrentValue(
    descriptors.find((descriptor) => descriptor.id === effortId),
  );
  const resolvedOptions = typeof effort === "string" ? { ...options, [effortId]: effort } : options;
  if (input.provider === "claudeAgent") {
    const normalized = normalizeClaudeModelOptions(input.model, resolvedOptions);
    return {
      provider: input.provider,
      promptEffort: normalized?.effort ?? null,
      modelOptionsForDispatch: normalized,
    };
  }
  return {
    provider: input.provider,
    promptEffort:
      typeof effort === "string" ? effort : (input.modelOptions?.codex?.reasoningEffort ?? null),
    modelOptionsForDispatch: resolvedOptions,
  };
}
