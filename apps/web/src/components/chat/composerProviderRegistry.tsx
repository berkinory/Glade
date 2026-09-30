import { type ModelSlug, type ProviderModelOptions } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { normalizeClaudeModelOptions } from "@glade/shared/provider/model";

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
  if (input.provider === "claudeAgent") {
    const normalized = normalizeClaudeModelOptions(input.model, input.modelOptions?.claudeAgent);
    return {
      provider: input.provider,
      promptEffort: normalized?.effort ?? null,
      modelOptionsForDispatch: normalized,
    };
  }
  return {
    provider: input.provider,
    promptEffort: input.modelOptions?.codex?.reasoningEffort ?? null,
    modelOptionsForDispatch: options,
  };
}
