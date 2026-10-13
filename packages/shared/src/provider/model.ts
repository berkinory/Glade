import {
  type ModelCapabilities,
  type ModelSlug,
  type ProviderOptionDescriptor,
  type ProviderOptionSelections,
  type SelectProviderOptionDescriptor,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { middleEffort } from "./effortLabel";
import { providerInheritedModelSlugs } from "./providerMetadata";

export interface SelectableModelOption {
  slug: string;
  name: string;
  isDefault?: boolean;
}

export const EMPTY_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
};
const MODEL_TOKEN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  gpt: "GPT",
  minimax: "MiniMax",
  openai: "OpenAI",
  swe: "SWE",
  xai: "xAI",
  xhigh: "XHigh",
};

const MODEL_FAMILY_TOKENS: ReadonlySet<string> = new Set([
  ...Object.keys(MODEL_TOKEN_DISPLAY_NAMES),
  "adaptive",
  "auto",
  "claude",
  "codex",
  "composer",
  "gemini",
  "inkling",
  "kimi",
  "nemotron",
]);

function humanizeModelToken(token: string): string {
  const key = token.toLowerCase();
  const displayName = Object.prototype.hasOwnProperty.call(MODEL_TOKEN_DISPLAY_NAMES, key)
    ? MODEL_TOKEN_DISPLAY_NAMES[key]
    : undefined;
  return displayName ?? token.charAt(0).toUpperCase() + token.slice(1);
}

const MODEL_DATE_OR_BUILD_TOKEN_PATTERN = /^\d{8}$/u;

function joinModelVersionTokens(tokens: string[]): string[] {
  const merged: string[] = [];
  for (const token of tokens) {
    const previous = merged[merged.length - 1];
    if (
      /^\d+$/u.test(token) &&
      (token === "0" || !token.startsWith("0")) &&
      !MODEL_DATE_OR_BUILD_TOKEN_PATTERN.test(token) &&
      previous !== undefined &&
      /\d$/u.test(previous)
    ) {
      merged[merged.length - 1] = `${previous}.${token}`;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

function restoreModelNameSeparators(name: string): string {
  return name.replace(/\bGPT (\d)/gu, "GPT-$1");
}

export function humanizeModelSlug(slug: string): string {
  if (slug.includes("/")) {
    return slug;
  }
  const tokens = joinModelVersionTokens(slug.split(/[-_]+/g)).map(humanizeModelToken);
  return restoreModelNameSeparators(tokens.join(" "));
}

export function normalizeModelDisplayName(name: string): string {
  const trimmed = name.trim();
  const parenIndex = trimmed.indexOf("(");
  const head = parenIndex >= 0 ? trimmed.slice(0, parenIndex).trimEnd() : trimmed;
  const tail = parenIndex >= 0 ? trimmed.slice(parenIndex) : "";
  const tokens = head.split(/[-_\s]+/u).filter(Boolean);
  const [firstToken] = tokens;
  if (firstToken === undefined || !MODEL_FAMILY_TOKENS.has(firstToken.toLowerCase())) {
    return trimmed;
  }
  const normalized = joinModelVersionTokens(tokens)
    .map((token) => {
      const displayName = Object.prototype.hasOwnProperty.call(
        MODEL_TOKEN_DISPLAY_NAMES,
        token.toLowerCase(),
      )
        ? MODEL_TOKEN_DISPLAY_NAMES[token.toLowerCase()]
        : undefined;
      return displayName ?? token;
    })
    .join(" ");
  return `${restoreModelNameSeparators(normalized)}${tail ? ` ${tail}` : ""}`;
}

export function formatModelDisplayName(model: string | null | undefined): string | undefined {
  const normalized = trimOrNull(model);
  if (!normalized) {
    return undefined;
  }

  return humanizeModelSlug(normalized);
}

// Providers name their effort option differently; either id marks the model's effort ladder.
const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set(["effort", "reasoningEffort"]);

export function isEffortOptionDescriptor(
  descriptor: ProviderOptionDescriptor,
): descriptor is SelectProviderOptionDescriptor {
  return descriptor.type === "select" && EFFORT_OPTION_IDS.has(descriptor.id);
}

export function storedEffortOptionValue(
  selections: ProviderOptionSelections | null | undefined,
): string | undefined {
  for (const id of EFFORT_OPTION_IDS) {
    const value = selections?.[id];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function cloneProviderOptionDescriptor(
  descriptor: ProviderOptionDescriptor,
): ProviderOptionDescriptor {
  if (descriptor.type === "select") {
    const effortDefault = isEffortOptionDescriptor(descriptor)
      ? middleEffort(descriptor.options)?.id
      : undefined;
    return {
      ...descriptor,
      options: descriptor.options.map((option) => {
        if (effortDefault === undefined) return { ...option };
        const { isDefault: _isDefault, ...choice } = option;
        return { ...choice, ...(option.id === effortDefault ? { isDefault: true as const } : {}) };
      }),
      ...(descriptor.promptInjectedValues
        ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
        : {}),
    };
  }
  return { ...descriptor };
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  const value = modelSelection?.options?.[id];
  return typeof value === "string" ? (trimOrNull(value) ?? undefined) : undefined;
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  const value = modelSelection?.options?.[id];
  return typeof value === "boolean" ? value : undefined;
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  rawValue: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(rawValue);
  return trimmed ?? descriptor.currentValue;
}

function withProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    return typeof rawValue === "boolean" ? { ...descriptor, currentValue: rawValue } : descriptor;
  }
  const currentValue =
    typeof rawValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _currentValue, ...rest } = descriptor;
    return rest;
  }
  return { ...descriptor, currentValue };
}

export function getProviderOptionDescriptors(input: {
  caps: ModelCapabilities;
  selections?: ProviderOptionSelections | null | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors = (input.caps.optionDescriptors ?? []).map(cloneProviderOptionDescriptor);
  return descriptors.map((descriptor) =>
    withProviderOptionCurrentValue(descriptor, input.selections?.[descriptor.id]),
  );
}

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return descriptor.currentValue;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

// Unset, "provider-default" and a provider's own default alias all inherit the native default model.
export function normalizeModelSlug(
  model: string | null | undefined,
  provider?: ProviderKind,
): ModelSlug | null {
  const trimmed = trimOrNull(model);
  return trimmed === "provider-default" ||
    (trimmed !== null &&
      provider !== undefined &&
      providerInheritedModelSlugs(provider).includes(trimmed))
    ? null
    : trimmed;
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): ModelSlug | null {
  if (!normalizeModelSlug(value, provider)) {
    return options.find((option) => option.isDefault)?.slug ?? null;
  }

  const trimmed = value!.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  if (resolved) {
    return resolved.slug;
  }

  return null;
}

export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}
