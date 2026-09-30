import {
  PROVIDER_DEFAULT_MODEL,
  type ClaudeApiEffort,
  type ClaudeModelOptions,
  type ClaudeCodeEffort,
  type ModelCapabilities,
  type ModelSlug,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

export interface SelectableModelOption {
  slug: string;
  name: string;
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

  return normalized === PROVIDER_DEFAULT_MODEL ? "Provider default" : humanizeModelSlug(normalized);
}

type ProviderOptionSelectionsInput =
  | ReadonlyArray<ProviderOptionSelection>
  | Record<string, unknown>
  | null
  | undefined;

function cloneProviderOptionDescriptor(
  descriptor: ProviderOptionDescriptor,
): ProviderOptionDescriptor {
  if (descriptor.type === "select") {
    return {
      ...descriptor,
      options: descriptor.options.map((option) => ({ ...option })),
      ...(descriptor.promptInjectedValues
        ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
        : {}),
    };
  }
  return { ...descriptor };
}

function providerOptionSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | boolean | undefined {
  if (!selections) {
    return undefined;
  }
  if (Array.isArray(selections)) {
    return selections.find((selection) => selection.id === id)?.value;
  }
  const selectionRecord = selections as Record<string, unknown>;
  const value = selectionRecord[id];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" || typeof value === "boolean" ? value : undefined;
}

export function getProviderOptionBooleanSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): boolean | undefined {
  const value = providerOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  const value = providerOptionSelectionValue(
    modelSelection?.options as ProviderOptionSelectionsInput,
    id,
  );
  return typeof value === "string" ? value : undefined;
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(
    modelSelection?.options as ProviderOptionSelectionsInput,
    id,
  );
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
  provider: ProviderKind;
  caps: ModelCapabilities;
  selections?: ProviderOptionSelectionsInput;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors = (input.caps.optionDescriptors ?? []).map(cloneProviderOptionDescriptor);
  return descriptors.map((descriptor) =>
    withProviderOptionCurrentValue(
      descriptor,
      providerOptionSelectionValue(input.selections, descriptor.id),
    ),
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

export function normalizeModelSlug(
  model: string | null | undefined,
  _provider: ProviderKind = "codex",
): ModelSlug | null {
  return trimOrNull(model);
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): ModelSlug | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
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

export function normalizeClaudeModelOptions(
  _model: string | null | undefined,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  if (!modelOptions) return undefined;
  const effort = getEffectiveClaudeCodeEffort(modelOptions.effort);
  const options: ClaudeModelOptions = {
    ...(effort ? { effort } : {}),
    ...(modelOptions.effort === "ultracode" ? { ultracode: true } : {}),
    ...(typeof modelOptions.ultracode === "boolean" ? { ultracode: modelOptions.ultracode } : {}),
    ...(typeof modelOptions.thinking === "boolean" ? { thinking: modelOptions.thinking } : {}),
    ...(typeof modelOptions.fastMode === "boolean" ? { fastMode: modelOptions.fastMode } : {}),
  };
  return Object.keys(options).length > 0 ? options : undefined;
}

export function resolveApiModelId(modelSelection: ModelSelection): string | undefined {
  return modelSelection.model === PROVIDER_DEFAULT_MODEL ? undefined : modelSelection.model;
}

export function getEffectiveClaudeCodeEffort(
  effort: ClaudeCodeEffort | null | undefined,
): ClaudeApiEffort | null {
  if (!effort || effort === "ultrathink") return null;
  return effort === "ultracode" ? "xhigh" : effort;
}
