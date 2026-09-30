import type { EffortOption, ModelCapabilities } from "@glade/contracts/provider/model";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import {
  getClaudeContextWindowSuffix,
  getDefaultEffort,
  getModelCapabilities,
  normalizeModelSlug,
  trimOrNull,
} from "@glade/shared/model";
import { normalizeClaudeModelOptionSlug } from "../../providerModelOptions";

function runtimeEffortLabel(value: string): string {
  switch (value) {
    case "none":
      return "None";
    case "minimal":
      return "Minimal";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra High";
    case "max":
      return "Max";
    default:
      return value
        .split(/[-_\s]+/u)
        .filter((segment) => segment.length > 0)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
  }
}

export function resolveRuntimeModelDescriptor(input: {
  provider: ProviderKind;
  model: string | null | undefined;
  runtimeModels: ReadonlyArray<ProviderModelDescriptor> | null | undefined;
}): ProviderModelDescriptor | undefined {
  const { provider, model, runtimeModels } = input;
  if (!runtimeModels?.length) {
    return undefined;
  }

  const normalizedModel = normalizeModelSlug(model, provider) ?? trimOrNull(model);
  if (!normalizedModel) {
    return undefined;
  }

  const exactMatch = runtimeModels.find((candidate) => {
    const normalizedCandidate = normalizeModelSlug(candidate.slug, provider) ?? candidate.slug;
    const normalizedResolvedModel =
      normalizeModelSlug(candidate.resolvedModel, provider) ?? candidate.resolvedModel;
    if (normalizedCandidate === normalizedModel || normalizedResolvedModel === normalizedModel) {
      return true;
    }
    return false;
  });
  if (exactMatch || provider !== "claudeAgent" || getClaudeContextWindowSuffix(model)) {
    return exactMatch;
  }

  return runtimeModels.find(
    (candidate) => normalizeClaudeModelOptionSlug(candidate) === normalizedModel,
  );
}

export function getRuntimeAwareModelCapabilities(input: {
  provider: ProviderKind;
  model: string | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
}): ModelCapabilities {
  const staticCapabilities = getModelCapabilities(input.provider, input.model);

  const supportsFastMode =
    input.provider === "codex" && input.runtimeModel
      ? input.runtimeModel.supportsFastMode === true
      : staticCapabilities.supportsFastMode;
  const supportsThinkingToggle =
    input.runtimeModel?.supportsThinkingToggle ?? staticCapabilities.supportsThinkingToggle;
  const contextWindowOptions =
    input.runtimeModel?.contextWindowOptions?.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.isDefault === true ? { isDefault: true as const } : {}),
    })) ?? staticCapabilities.contextWindowOptions;
  const optionDescriptors =
    input.runtimeModel?.optionDescriptors ?? staticCapabilities.optionDescriptors;
  const runtimeEfforts = input.runtimeModel?.supportedReasoningEfforts;

  if (input.provider !== "codex" || !runtimeEfforts || runtimeEfforts.length === 0) {
    return {
      ...staticCapabilities,
      ...(optionDescriptors ? { optionDescriptors } : {}),
      supportsFastMode,
      supportsThinkingToggle,
      contextWindowOptions,
    };
  }

  const staticDefaultEffort = getDefaultEffort(staticCapabilities);
  const runtimeDefaultEffort =
    trimOrNull(input.runtimeModel?.defaultReasoningEffort) ??
    (staticDefaultEffort && runtimeEfforts.some((effort) => effort.value === staticDefaultEffort)
      ? staticDefaultEffort
      : null);

  const runtimeOptions: EffortOption[] = runtimeEfforts.map((effort) => {
    const description = trimOrNull(effort.description);
    return Object.assign(
      { value: effort.value, label: trimOrNull(effort.label) ?? runtimeEffortLabel(effort.value) },
      description ? { description } : {},
      effort.value === runtimeDefaultEffort ? { isDefault: true as const } : {},
    );
  });

  return {
    ...staticCapabilities,
    ...(optionDescriptors ? { optionDescriptors } : {}),
    supportsFastMode,
    supportsThinkingToggle,
    contextWindowOptions,
    reasoningEffortLevels: runtimeOptions,
  };
}
