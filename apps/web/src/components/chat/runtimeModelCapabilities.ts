import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import { PROVIDER_DEFAULT_MODEL, type ModelCapabilities } from "@glade/contracts/provider/model";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { EMPTY_MODEL_CAPABILITIES } from "@glade/shared/provider/model";

export function resolveRuntimeModelDescriptor(input: {
  provider: ProviderKind;
  model: string | null | undefined;
  runtimeModels: ReadonlyArray<ProviderModelDescriptor> | null | undefined;
}): ProviderModelDescriptor | undefined {
  const models = input.runtimeModels;
  if (input.model === PROVIDER_DEFAULT_MODEL) return models?.find((model) => model.isDefault);
  return models?.find((model) => model.slug === input.model || model.resolvedModel === input.model);
}

export function getRuntimeAwareModelCapabilities(input: {
  provider: ProviderKind;
  model: string | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
}): ModelCapabilities {
  const model = input.runtimeModel;
  if (!model) return EMPTY_MODEL_CAPABILITIES;
  return {
    ...EMPTY_MODEL_CAPABILITIES,
    optionDescriptors: model.optionDescriptors ?? [],
    supportsFastMode: model.supportsFastMode === true,
    supportsThinkingToggle: model.supportsThinkingToggle === true,
    reasoningEffortLevels: (model.supportedReasoningEfforts ?? []).map((effort) => ({
      value: effort.value,
      label: effort.label ?? formatEffortLabel(effort.value),
      ...(effort.description ? { description: effort.description } : {}),
      ...(effort.value === model.defaultReasoningEffort ? { isDefault: true as const } : {}),
    })),
  };
}
