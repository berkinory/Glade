import {
  formatModelDisplayName,
  normalizeModelDisplayName,
  normalizeModelSlug,
  resolveNewestKnownClaudeFamilyModel,
} from "@glade/shared/provider/model";
import {
  MODEL_OPTIONS_BY_PROVIDER,
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

function normalizeCatalogModelName(name: string): string {
  return normalizeModelDisplayName(name);
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

function normalizeDynamicModelSlug(provider: ProviderKind, slug: string): string {
  if (provider === "claudeAgent") {
    const withoutContextSuffix = slug.replace(/\[[^\]]+\]$/u, "");
    return normalizeModelSlug(withoutContextSuffix, provider) ?? withoutContextSuffix;
  }
  return normalizeModelSlug(slug, provider) ?? slug;
}

// Claude Code lists its current models by alias (`opus[1m]`) with the concrete id in
// `resolvedModel`. When that id is a release newer than the catalog knows, list it under its own
// id; otherwise the alias would fold into an older catalog model.
export function normalizeClaudeModelOptionSlug(model: {
  slug: string;
  resolvedModel?: string | undefined;
}): string {
  const resolvedSlug = model.resolvedModel
    ? normalizeDynamicModelSlug("claudeAgent", model.resolvedModel)
    : null;
  return resolvedSlug && resolveNewestKnownClaudeFamilyModel(resolvedSlug)
    ? resolvedSlug
    : normalizeDynamicModelSlug("claudeAgent", model.slug);
}

const CLAUDE_CATALOG_RANK_BY_SLUG: ReadonlyMap<string, number> = new Map(
  MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((model, index) => [model.slug as string, index]),
);

function claudeModelRank(slug: string): number {
  const catalogRank = CLAUDE_CATALOG_RANK_BY_SLUG.get(slug);
  if (catalogRank !== undefined) {
    return catalogRank;
  }
  const newestKnown = resolveNewestKnownClaudeFamilyModel(slug);
  const familyRank = newestKnown ? CLAUDE_CATALOG_RANK_BY_SLUG.get(newestKnown) : undefined;
  return familyRank === undefined ? -1 : familyRank - 0.5;
}

function orderClaudeModelOptions<T extends ProviderModelOption>(
  options: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return options.toSorted(
    (left, right) => claudeModelRank(left.slug) - claudeModelRank(right.slug),
  );
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
  }>;
}): ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }> {
  const staticNameBySlug = new Map(
    input.staticOptions
      .filter((model) => !model.isSelectedHint)
      .map((model) => [model.slug, model.name]),
  );
  const dynamicNormalizedSlugs = new Set<string>();
  const normalizedDynamicOptions: ProviderModelOption[] = [];

  for (const dynamicModel of input.dynamicModels) {
    const rawName = dynamicModel.name?.trim() ?? "";
    const isClaudeDefaultAlias =
      input.provider === "claudeAgent" &&
      (rawName.toLowerCase() === "default (recommended)" ||
        rawName.toLowerCase() === "default recommended" ||
        dynamicModel.slug.trim().toLowerCase() === "default");
    if (isClaudeDefaultAlias) {
      continue;
    }

    const normalizedSlug =
      input.provider === "claudeAgent"
        ? normalizeClaudeModelOptionSlug(dynamicModel)
        : normalizeDynamicModelSlug(input.provider, dynamicModel.slug);
    const modelIdentifier = normalizedSlug.slice(normalizedSlug.lastIndexOf("/") + 1);
    const displayNameFallback = formatProviderModelOptionName({
      provider: input.provider,
      slug: normalizedSlug,
    });
    if (dynamicNormalizedSlugs.has(normalizedSlug)) {
      continue;
    }
    dynamicNormalizedSlugs.add(normalizedSlug);
    normalizedDynamicOptions.push({
      slug: normalizedSlug,
      name:
        staticNameBySlug.get(normalizedSlug) ??
        (input.provider === "claudeAgent" && resolveNewestKnownClaudeFamilyModel(normalizedSlug)
          ? displayNameFallback
          : undefined) ??
        (rawName.length > 0 &&
        rawName !== dynamicModel.slug.trim() &&
        rawName !== normalizedSlug &&
        rawName !== modelIdentifier
          ? normalizeCatalogModelName(rawName)
          : displayNameFallback),
      ...(dynamicModel.description?.trim() ? { description: dynamicModel.description.trim() } : {}),
      ...(dynamicModel.upstreamProviderId?.trim()
        ? { upstreamProviderId: dynamicModel.upstreamProviderId.trim() }
        : {}),
      ...(dynamicModel.upstreamProviderName?.trim()
        ? { upstreamProviderName: dynamicModel.upstreamProviderName.trim() }
        : {}),
    });
  }

  const selectedOnlyModels = input.staticOptions.filter((model) => {
    if (!("isSelectedHint" in model) || !model.isSelectedHint) return false;
    const normalizedSelectedSlug = normalizeDynamicModelSlug(input.provider, model.slug);
    if (dynamicNormalizedSlugs.has(normalizedSelectedSlug)) return false;
    return true;
  });
  const staticBuiltInModels = input.staticOptions.filter(
    (model) => !("isSelectedHint" in model) || model.isSelectedHint !== true,
  );
  const hasAuthoritativeCatalog = input.provider === "codex";
  const missingStaticBuiltIns = hasAuthoritativeCatalog
    ? []
    : staticBuiltInModels.filter((model) => !dynamicNormalizedSlugs.has(model.slug));

  if (input.provider === "claudeAgent") {
    return [
      ...orderClaudeModelOptions([...normalizedDynamicOptions, ...missingStaticBuiltIns]),
      ...selectedOnlyModels,
    ];
  }

  return [...normalizedDynamicOptions, ...missingStaticBuiltIns, ...selectedOnlyModels];
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
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>,
): ProviderOptions {
  if (provider === "codex") {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions;
  }
  if (provider === "claudeAgent") {
    return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions;
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions;
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
