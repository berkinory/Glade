import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
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
    case "dontAsk":
      return value;
    default:
      return undefined;
  }
}

function mapClaudeModelInfo(
  model: ModelInfo,
  defaultEffort?: string | null,
): ProviderListModelsResult["models"][number] {
  const effortOptions = model.supportsEffort
    ? (model.supportedEffortLevels ?? []).map((level) => ({
        id: level,
        label: formatEffortLabel(level),
        ...(level === defaultEffort ? { isDefault: true as const } : {}),
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
  return models.find((model) =>
    selectedModel && selectedModel !== "provider-default"
      ? claudeModelIdentifiers(model).includes(selectedModel)
      : model.value === "default",
  );
}

export function mapClaudeModelCatalog(
  models: ReadonlyArray<ModelInfo>,
  defaultEffortByModel: Readonly<Record<string, string | null>> = {},
): ProviderListModelsResult["models"] {
  const defaultEntry = models.find((model) => model.value === "default");
  const defaultModel = defaultEntry?.resolvedModel;
  const catalog = models
    .filter((model) => model.value !== "default")
    .map((model) => ({
      ...mapClaudeModelInfo(model, defaultEffortByModel[model.value]),
      ...(defaultModel && claudeModelIdentifiers(model).includes(defaultModel)
        ? { slug: defaultModel, isDefault: true }
        : {}),
    }));
  if (defaultModel && defaultEntry && !catalog.some((model) => model.isDefault)) {
    catalog.unshift({
      ...mapClaudeModelInfo(defaultEntry, defaultEffortByModel[defaultEntry.value]),
      slug: defaultModel,
      name: defaultModel,
      isDefault: true,
    });
  }
  return catalog;
}
