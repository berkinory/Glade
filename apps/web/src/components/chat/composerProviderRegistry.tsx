import {
  type ModelSlug,
  type ProviderModelOptions,
  type ProviderOptionSelections,
} from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import {
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isEffortOptionDescriptor,
  storedEffortOptionValue,
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
  modelOptionsForDispatch: ProviderOptionSelections | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const options = input.modelOptions?.[input.provider];
  const effortDescriptor = getProviderOptionDescriptors({
    caps: getRuntimeAwareModelCapabilities(input),
    selections: options,
  }).find(isEffortOptionDescriptor);
  const effort = getProviderOptionCurrentValue(effortDescriptor);
  return {
    provider: input.provider,
    promptEffort: typeof effort === "string" ? effort : (storedEffortOptionValue(options) ?? null),
    modelOptionsForDispatch:
      effortDescriptor && typeof effort === "string"
        ? { ...options, [effortDescriptor.id]: effort }
        : options,
  };
}
