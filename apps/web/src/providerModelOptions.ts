import { formatModelDisplayName } from "@glade/shared/provider/model";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderOptionSelections,
  type ProviderOptionValue,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

// An undefined value clears that option.
export type ProviderOptionPatch = Readonly<Record<string, ProviderOptionValue | undefined>>;

export interface ProviderModelOption {
  isDefault?: boolean;
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

export function formatProviderModelOptionName(slug: string): string {
  const trimmedSlug = slug.trim();
  if (trimmedSlug.length === 0) {
    return trimmedSlug;
  }

  return formatModelDisplayName(trimmedSlug) ?? trimmedSlug;
}

function withoutProviderName(provider: ProviderKind, name: string): string | null {
  const providerName = PROVIDER_DISPLAY_NAMES[provider].toLowerCase();
  const trimmed = name.trim();
  if (!trimmed.toLowerCase().startsWith(providerName)) return null;
  const rest = trimmed.slice(providerName.length);
  return /^\s+\p{L}/u.test(rest) ? rest.trimStart() : null;
}

// Only for surfaces that show the provider beside the name. Drops a leading provider name the
// provider's icon already says ("Claude Opus 5" reads "Opus 5"). The full name stays when the
// rest would not start with a word (a bare version or a parenthetical) or would read the same
// as another model in the provider's catalog.
export function formatProviderScopedModelName(
  provider: ProviderKind,
  name: string,
  catalogNames: ReadonlyArray<string>,
): string {
  const shortName = withoutProviderName(provider, name);
  if (shortName === null) return name;
  const key = shortName.toLowerCase();
  const collides = catalogNames.some(
    (other) =>
      other !== name &&
      (other.trim().toLowerCase() === key ||
        withoutProviderName(provider, other)?.toLowerCase() === key),
  );
  return collides ? name : shortName;
}

export function mergeDynamicModelOptions(input: {
  staticOptions: ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>;
  dynamicModels: ReadonlyArray<{
    slug: string;
    resolvedModel?: string | undefined;
    name?: string | null | undefined;
    description?: string | null | undefined;
    upstreamProviderId?: string | null | undefined;
    upstreamProviderName?: string | null | undefined;
    hidden?: boolean | undefined;
    isDefault?: boolean | undefined;
  }>;
}): ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }> {
  const models = new Map<string, ProviderModelOption & { isSelectedHint?: boolean }>();
  for (const model of input.dynamicModels) {
    if (model.hidden) continue;
    models.set(model.slug, {
      slug: model.slug,
      ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
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

export function buildNextProviderOptions(
  modelOptions: ProviderOptionSelections | null | undefined,
  patch: ProviderOptionPatch,
): ProviderOptionSelections {
  const next: Record<string, ProviderOptionValue> = { ...modelOptions };
  for (const [id, value] of Object.entries(patch)) {
    if (value === undefined) delete next[id];
    else next[id] = value;
  }
  return next;
}

export function buildModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderOptionSelections | null | undefined,
  supportsAutoMode?: boolean | undefined,
): ModelSelection {
  return {
    provider,
    model,
    ...(options ? { options } : {}),
    ...(typeof supportsAutoMode === "boolean" ? { supportsAutoMode } : {}),
  };
}
