import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { PROVIDER_DEFAULT_MODEL } from "@glade/contracts/provider/model";
import { type ProviderListModelsResult } from "@glade/contracts/provider/providerDiscovery";

type ClaudeAutoModeModelResolution =
  | { readonly status: "matched"; readonly model: ModelInfo }
  | { readonly status: "absent" }
  | { readonly status: "conflicting" };

function claudeModelIdentifiers(model: ModelInfo): ReadonlyArray<string> {
  return model.resolvedModel === undefined ? [model.value] : [model.value, model.resolvedModel];
}

export function resolveClaudeAutoModeModel(
  discoveredModels: ReadonlyArray<ModelInfo>,
  requestedModelIds: ReadonlySet<string>,
): ClaudeAutoModeModelResolution {
  const exactMatch = discoveredModels.find((model) =>
    claudeModelIdentifiers(model).some((identifier) => requestedModelIds.has(identifier)),
  );
  if (exactMatch) {
    return { status: "matched", model: exactMatch };
  }

  return { status: "absent" };
}

export function resolveSelectedClaudeThinkingToggle(
  model: ModelInfo | undefined,
  selectedThinking: boolean | null | undefined,
): boolean | undefined {
  if (typeof selectedThinking !== "boolean") {
    return undefined;
  }
  return model?.supportsAdaptiveThinking === true ? selectedThinking : undefined;
}

export function toPermissionMode(value: unknown): PermissionMode | undefined {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
    case "dontAsk":
      return value;
    default:
      return undefined;
  }
}

export function mapClaudeModelInfo(model: ModelInfo): ProviderListModelsResult["models"][number] {
  const effortOptions = model.supportsEffort
    ? (model.supportedEffortLevels ?? []).map((level) => ({
        id: level,
        label:
          level === "xhigh"
            ? "Extra High"
            : level === "max"
              ? "Max"
              : level[0]!.toUpperCase() + level.slice(1),
      }))
    : [];
  const optionDescriptors: NonNullable<
    ProviderListModelsResult["models"][number]["optionDescriptors"]
  > = [
    ...(effortOptions.length > 0
      ? [{ id: "effort", label: "Effort", type: "select" as const, options: effortOptions }]
      : []),
    ...(model.supportsAdaptiveThinking
      ? [{ id: "thinking", label: "Adaptive thinking", type: "boolean" as const }]
      : []),
    ...(model.supportsFastMode
      ? [{ id: "fastMode", label: "Fast mode", type: "boolean" as const }]
      : []),
  ];
  return {
    slug: model.value,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    name: model.displayName,
    description: model.description,
    ...(optionDescriptors.length > 0 ? { optionDescriptors } : {}),
    ...(typeof model.supportsAutoMode === "boolean"
      ? { supportsAutoMode: model.supportsAutoMode }
      : {}),
  };
}

export function selectedClaudeModelInfo(
  models: ReadonlyArray<ModelInfo>,
  selectedModel: string | null | undefined,
): ModelInfo | undefined {
  return selectedModel && selectedModel !== PROVIDER_DEFAULT_MODEL
    ? models.find((model) => claudeModelIdentifiers(model).includes(selectedModel))
    : undefined;
}
