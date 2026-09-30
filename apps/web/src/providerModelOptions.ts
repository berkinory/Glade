import { formatModelDisplayName } from "@glade/shared/provider/model";
import {
  PROVIDER_DEFAULT_MODEL,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderModelOptions,
} from "@glade/contracts/provider/model";
import {
  type ClaudeModelSelection,
  type CodexModelSelection,
  type ModelSelection,
} from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

export type ProviderOptions = ProviderModelOptions[ProviderKind];

export interface ProviderModelOption {
  slug: string;
  name: string;
  description?: string;
  upstreamProviderId?: string;
  upstreamProviderName?: string;
}

export interface ProviderModelOptionGroup {
  key: string;
  label: string | null;
  options: ProviderModelOption[];
}

export function formatProviderModelOptionName(input: {
  provider: ProviderKind;
  slug: string;
}): string {
  const trimmedSlug = input.slug.trim();
  if (trimmedSlug.length === 0) {
    return trimmedSlug;
  }

  return formatModelDisplayName(trimmedSlug) ?? trimmedSlug;
}

export function mergeDynamicModelOptions(input: {
  provider: ProviderKind;
  staticOptions: ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>;
  dynamicModels: ReadonlyArray<{
    slug: string;
    resolvedModel?: string | undefined;
    name?: string | null | undefined;
    description?: string | null | undefined;
    upstreamProviderId?: string | null | undefined;
    upstreamProviderName?: string | null | undefined;
    hidden?: boolean | undefined;
  }>;
}): ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }> {
  const models = new Map<string, ProviderModelOption & { isSelectedHint?: boolean }>();
  models.set(PROVIDER_DEFAULT_MODEL, { slug: PROVIDER_DEFAULT_MODEL, name: "Provider default" });
  for (const model of input.dynamicModels) {
    if (model.hidden) continue;
    models.set(model.slug, {
      slug: model.slug,
      name: model.name?.trim() || model.slug,
      ...(model.description ? { description: model.description } : {}),
      ...(model.upstreamProviderId ? { upstreamProviderId: model.upstreamProviderId } : {}),
      ...(model.upstreamProviderName ? { upstreamProviderName: model.upstreamProviderName } : {}),
    });
  }
  for (const model of input.staticOptions) {
    if (model.isSelectedHint && !models.has(model.slug)) models.set(model.slug, model);
  }
  return [...models.values()];
}

export function groupProviderModelOptions(
  options: ReadonlyArray<ProviderModelOption>,
): ProviderModelOptionGroup[] {
  const groupedOptions: ProviderModelOptionGroup[] = [];
  const groupIndexByKey = new Map<string, number>();

  for (const option of options) {
    const upstreamProviderId = option.upstreamProviderId?.trim();
    const upstreamProviderName = option.upstreamProviderName?.trim();
    const groupLabel =
      upstreamProviderName && upstreamProviderName.length > 0
        ? upstreamProviderName
        : upstreamProviderId && upstreamProviderId.length > 0
          ? upstreamProviderId
          : null;
    const groupKey = groupLabel
      ? `${(upstreamProviderId ?? groupLabel).trim().toLowerCase()}`
      : "__ungrouped__";
    const existingIndex = groupIndexByKey.get(groupKey);

    if (existingIndex !== undefined) {
      groupedOptions[existingIndex]!.options.push(option);
      continue;
    }

    groupIndexByKey.set(groupKey, groupedOptions.length);
    groupedOptions.push({
      key: groupKey,
      label: groupLabel,
      options: [option],
    });
  }

  return groupedOptions;
}

const COLLAPSIBLE_MODEL_GROUP_THRESHOLD = 3;

export function shouldUseCollapsibleModelGroups(groupCount: number, isSearching: boolean): boolean {
  return groupCount >= COLLAPSIBLE_MODEL_GROUP_THRESHOLD && !isSearching;
}

export function resolveModelGroupDefaultOpen(input: {
  groupKey: string;
  options: ReadonlyArray<ProviderModelOption>;
  activeModel: string;
  groupCount: number;
}): boolean {
  if (input.groupCount < COLLAPSIBLE_MODEL_GROUP_THRESHOLD) {
    return true;
  }
  if (input.groupKey === "__favorites__") {
    return true;
  }
  return input.options.some((option) => option.slug === input.activeModel);
}

export function buildNextProviderOptions(
  _provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>,
): ProviderOptions {
  const next = { ...modelOptions, ...patch };
  for (const [id, value] of Object.entries(next)) {
    if (value === undefined) delete next[id as keyof typeof next];
  }
  return next;
}

export function buildProviderOptionPatch(
  _provider: ProviderKind,
  optionId: string,
  value: string | boolean,
): Record<string, unknown> {
  return { [optionId]: value };
}

export function buildModelSelection(
  provider: "codex",
  model: string,
  options?: CodexModelOptions | null | undefined,
): CodexModelSelection;
export function buildModelSelection(
  provider: "claudeAgent",
  model: string,
  options?: ClaudeModelOptions | null | undefined,
  supportsAutoMode?: boolean | undefined,
): ClaudeModelSelection;
export function buildModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderOptions | null | undefined,
  supportsAutoMode?: boolean | undefined,
): ModelSelection;
export function buildModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderOptions | null | undefined,
  supportsAutoMode?: boolean | undefined,
): ModelSelection {
  switch (provider) {
    case "codex":
      return options
        ? {
            provider,
            model,
            options: options as CodexModelOptions,
          }
        : { provider, model };
    case "claudeAgent":
      return {
        provider,
        model,
        ...(options ? { options: options as ClaudeModelOptions } : {}),
        ...(typeof supportsAutoMode === "boolean" ? { supportsAutoMode } : {}),
      };
  }
}
