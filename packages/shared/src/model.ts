import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_CAPABILITIES_INDEX,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ClaudeApiEffort,
  type ClaudeModelOptions,
  type ClaudeCodeEffort,
  type ModelCapabilities,
  type ModelSelection,
  type ModelSlug,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ProviderKind,
} from "@glade/contracts";

const MODEL_SLUG_SET_BY_PROVIDER: Record<ProviderKind, ReadonlySet<ModelSlug>> = {
  claudeAgent: new Set(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((option) => option.slug)),
  codex: new Set(MODEL_OPTIONS_BY_PROVIDER.codex.map((option) => option.slug)),
};

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
export function getModelOptions(provider: ProviderKind = "codex") {
  return MODEL_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultModel(provider: ProviderKind = "codex"): ModelSlug {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

const MODEL_NAME_BY_SLUG = new Map(
  Object.values(MODEL_OPTIONS_BY_PROVIDER)
    .flat()
    .map((option) => [option.slug.toLowerCase(), option.name] as const),
);

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

// First tokens that mark a provider-supplied label as a model-family name
// worth normalizing: the brand tokens plus families whose casing is already
// title-case. Anything else (custom names like "MyModel", "K2P6") keeps its
// original casing untouched.
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

// Rejoins version fragments split on "-"/"_": a pure-digit token merges onto a
// preceding token that already ends in a digit, so "swe-1-6" reads as 1.6,
// "claude-opus-4-8" as 4.8, and "kimi-k2-6" as K2.6. Zero-prefixed tokens and
// eight-digit provider date/build stamps stay separate, never version minors.
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

// Canonical brand shapes that differ from plain space-joined words.
function restoreModelNameSeparators(name: string): string {
  return name.replace(/\bGPT (\d)/gu, "GPT-$1");
}

// Turns a raw model slug into a readable label when no built-in name exists.
// Provider-scoped custom ids ("vendor/model") stay verbatim; everything else is
// tokenized on -/_, version fragments rejoined with ".", known model-family
// brands restored to their canonical casing, and GPT versions rehyphenated.
export function humanizeModelSlug(slug: string): string {
  if (slug.includes("/")) {
    return slug;
  }
  const tokens = joinModelVersionTokens(slug.split(/[-_]+/g)).map(humanizeModelToken);
  return restoreModelNameSeparators(tokens.join(" "));
}

/**
 * Normalizes a provider-supplied display name to Glade's canonical casing:
 * known brand tokens are re-cased ("Swe" → "SWE", "Deepseek" → "DeepSeek"),
 * slug separators become spaces ("GLM-5.3-Flash" → "GLM 5.3 Flash"), digit
 * fragments rejoin as versions, and GPT versions keep their hyphen. Gated on a
 * known family first token so freeform names keep their casing; non-brand
 * tokens and a parenthesized tail pass through unchanged.
 */
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

  return MODEL_NAME_BY_SLUG.get(normalized.toLowerCase()) ?? humanizeModelSlug(normalized);
}

// ── Effort helpers ────────────────────────────────────────────────────

export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  return caps.reasoningEffortLevels.some((l) => l.value === value);
}

export function getDefaultEffort(caps: ModelCapabilities): string | null {
  return caps.reasoningEffortLevels.find((l) => l.isDefault)?.value ?? null;
}

export function hasContextWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.contextWindowOptions.some((option) => option.value === value);
}

export function getDefaultContextWindow(caps: ModelCapabilities): string | null {
  return caps.contextWindowOptions.find((option) => option.isDefault)?.value ?? null;
}

export function hasAutoCompactWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.autoCompactWindowOptions?.some((option) => option.value === value) ?? false;
}

// Claude model ids may carry a context-window qualifier, e.g. `claude-fable-5-1[1m]`.
const CLAUDE_CONTEXT_WINDOW_SUFFIX_PATTERN = /\[([^\]]+)\]$/u;

export function getClaudeContextWindowSuffix(model: string | null | undefined): string | null {
  if (typeof model !== "string") return null;
  return CLAUDE_CONTEXT_WINDOW_SUFFIX_PATTERN.exec(model)?.[1]?.toLowerCase() ?? null;
}

export function stripClaudeContextWindowSuffix(model: string): string {
  return model.replace(CLAUDE_CONTEXT_WINDOW_SUFFIX_PATTERN, "");
}

export function getDefaultAutoCompactWindow(caps: ModelCapabilities): string | null {
  return caps.autoCompactWindowOptions?.find((option) => option.isDefault)?.value ?? null;
}

export function resolveLabeledOptionValue(
  options: ReadonlyArray<{ value: string; isDefault?: boolean | undefined }> | undefined,
  rawValue: string | null | undefined,
): string | null {
  const trimmedValue = trimOrNull(rawValue);
  if (!options || options.length === 0) {
    return trimmedValue;
  }
  if (trimmedValue && options.some((option) => option.value === trimmedValue)) {
    return trimmedValue;
  }
  return options.find((option) => option.isDefault)?.value ?? options[0]?.value ?? null;
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
  if (trimmed && descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
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

function reasoningDescriptorId(provider: ProviderKind): string {
  if (provider === "claudeAgent") {
    return "effort";
  }
  return "reasoningEffort";
}

function legacyCapabilityDescriptors(
  provider: ProviderKind,
  caps: ModelCapabilities,
): ProviderOptionDescriptor[] {
  const primaryOptions = caps.reasoningEffortLevels;
  const descriptors: ProviderOptionDescriptor[] = [];
  if (primaryOptions.length > 0) {
    const defaultPrimaryOption = primaryOptions.find((option) => option.isDefault);
    descriptors.push({
      id: reasoningDescriptorId(provider),
      label: "Reasoning",
      type: "select",
      options: primaryOptions.map((option) =>
        Object.assign(
          { id: option.value, label: option.label },
          option.description ? { description: option.description } : {},
          option.isDefault ? { isDefault: true as const } : {},
        ),
      ),
      ...(defaultPrimaryOption ? { currentValue: defaultPrimaryOption.value } : {}),
      ...(caps.promptInjectedEffortLevels.length > 0
        ? { promptInjectedValues: [...caps.promptInjectedEffortLevels] }
        : {}),
    });
  }
  if (caps.contextWindowOptions.length > 0) {
    const defaultContextWindowOption = caps.contextWindowOptions.find((option) => option.isDefault);
    descriptors.push({
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: caps.contextWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true as const } : {}),
      })),
      ...(defaultContextWindowOption ? { currentValue: defaultContextWindowOption.value } : {}),
    });
  }
  if (caps.autoCompactWindowOptions && caps.autoCompactWindowOptions.length > 0) {
    const defaultOption = caps.autoCompactWindowOptions.find((option) => option.isDefault);
    descriptors.push({
      id: "autoCompactWindow",
      label: "Auto-compact",
      type: "select",
      options: caps.autoCompactWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true as const } : {}),
      })),
      ...(defaultOption ? { currentValue: defaultOption.value } : {}),
    });
  }
  if (caps.supportsFastMode) {
    descriptors.push({ id: "fastMode", label: "Fast Mode", type: "boolean" });
  }
  if (caps.supportsThinkingToggle) {
    descriptors.push({ id: "thinking", label: "Thinking", type: "boolean", currentValue: true });
  }
  return descriptors;
}

export function getProviderOptionDescriptors(input: {
  provider: ProviderKind;
  caps: ModelCapabilities;
  selections?: ProviderOptionSelectionsInput;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors =
    input.caps.optionDescriptors?.map(cloneProviderOptionDescriptor) ??
    legacyCapabilityDescriptors(input.provider, input.caps);
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

// ── Data-driven capability resolver ───────────────────────────────────

export function getModelCapabilities(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelCapabilities {
  const normalizedSlug = normalizeModelSlug(model, provider);
  const slug =
    provider === "claudeAgent" && normalizedSlug
      ? stripClaudeContextWindowSuffix(normalizedSlug)
      : normalizedSlug;
  if (slug && MODEL_CAPABILITIES_INDEX[provider]?.[slug]) {
    return MODEL_CAPABILITIES_INDEX[provider][slug];
  }
  if (provider === "claudeAgent" && slug) {
    const newestKnown = resolveNewestKnownClaudeFamilyModel(slug);
    if (newestKnown) {
      return MODEL_CAPABILITIES_INDEX.claudeAgent[newestKnown] ?? EMPTY_MODEL_CAPABILITIES;
    }
  }
  return EMPTY_MODEL_CAPABILITIES;
}

// Claude Code ships new models before Glade's catalog lists them. Catalog
// entries always win; only an id that is newer than every catalog model of its
// family borrows that family's newest capabilities. Older or unrecognized ids
// keep the empty fallback so custom and legacy selections do not gain options.
const CLAUDE_FAMILY_MODEL_PATTERN =
  /^claude-(fable|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/u;

type ClaudeFamilyModelVersion = {
  readonly family: string;
  readonly major: number;
  readonly minor: number;
};

function parseClaudeFamilyModelVersion(slug: string): ClaudeFamilyModelVersion | null {
  const match = CLAUDE_FAMILY_MODEL_PATTERN.exec(slug.trim().toLowerCase());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { family: match[1], major: Number(match[2]), minor: Number(match[3] ?? 0) };
}

function compareClaudeFamilyModelVersions(
  left: ClaudeFamilyModelVersion,
  right: ClaudeFamilyModelVersion,
): number {
  return left.major - right.major || left.minor - right.minor;
}

const NEWEST_CLAUDE_CATALOG_MODEL_BY_FAMILY = (() => {
  const newest = new Map<string, { slug: ModelSlug; version: ClaudeFamilyModelVersion }>();
  for (const model of MODEL_OPTIONS_BY_PROVIDER.claudeAgent) {
    const version = parseClaudeFamilyModelVersion(model.slug);
    const current = version ? newest.get(version.family) : undefined;
    if (version && (!current || compareClaudeFamilyModelVersions(version, current.version) > 0)) {
      newest.set(version.family, { slug: model.slug, version });
    }
  }
  return newest;
})();

/**
 * Returns the newest catalog model of `slug`'s Claude family when `slug` is a
 * newer release the catalog does not list yet (e.g. `claude-opus-6` → the
 * newest catalog Opus). Catalog, older, and unrecognized ids return `null`.
 */
export function resolveNewestKnownClaudeFamilyModel(
  model: string | null | undefined,
): ModelSlug | null {
  const normalized = normalizeModelSlug(model, "claudeAgent");
  if (!normalized) {
    return null;
  }
  const slug = stripClaudeContextWindowSuffix(normalized) as ModelSlug;
  if (MODEL_SLUG_SET_BY_PROVIDER.claudeAgent.has(slug)) {
    return null;
  }
  const version = parseClaudeFamilyModelVersion(slug);
  const newest = version ? NEWEST_CLAUDE_CATALOG_MODEL_BY_FAMILY.get(version.family) : undefined;
  return version && newest && compareClaudeFamilyModelVersions(version, newest.version) > 0
    ? newest.slug
    : null;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const providerScopedModel =
    provider === "claudeAgent" ? stripClaudeContextWindowSuffix(trimmed) : trimmed;
  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, ModelSlug>;
  const aliasKey = providerScopedModel.toLowerCase();
  const aliased = Object.prototype.hasOwnProperty.call(aliases, aliasKey)
    ? aliases[aliasKey]
    : undefined;
  const normalized = typeof aliased === "string" ? aliased : providerScopedModel;
  return (
    provider === "claudeAgent" && getClaudeContextWindowSuffix(trimmed) === "1m"
      ? `${normalized}[1m]`
      : normalized
  ) as ModelSlug;
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

export function resolveModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  const normalizedModel = normalizeModelSlug(model, provider);
  const normalized =
    provider === "claudeAgent" && normalizedModel
      ? (stripClaudeContextWindowSuffix(normalizedModel) as ModelSlug)
      : normalizedModel;
  if (!normalized) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  return MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)
    ? normalized
    : DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSlug | null {
  return resolveModelSlug(model, provider);
}

export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

/**
 * Keeps only explicit Claude option overrides. The model-native auto-compact
 * window stays unset so Claude Code can apply server tuning, settings.json,
 * and CLAUDE_CODE_AUTO_COMPACT_WINDOW.
 */
export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  const caps = getModelCapabilities("claudeAgent", model);
  const defaultReasoningEffort = getDefaultEffort(caps);
  const defaultAutoCompactWindow = getDefaultAutoCompactWindow(caps);
  const resolvedEffort = trimOrNull(modelOptions?.effort);
  const resolvedAutoCompactWindow =
    trimOrNull(modelOptions?.autoCompactWindow) ?? trimOrNull(modelOptions?.contextWindow);
  const isPromptInjected = caps.promptInjectedEffortLevels.includes(resolvedEffort ?? "");
  const effort =
    resolvedEffort &&
    !isPromptInjected &&
    hasEffortLevel(caps, resolvedEffort) &&
    resolvedEffort !== defaultReasoningEffort
      ? resolvedEffort
      : undefined;
  const autoCompactWindow =
    resolvedAutoCompactWindow &&
    hasAutoCompactWindowOption(caps, resolvedAutoCompactWindow) &&
    resolvedAutoCompactWindow !== defaultAutoCompactWindow
      ? resolvedAutoCompactWindow
      : undefined;
  const thinking =
    caps.supportsThinkingToggle && modelOptions?.thinking === false ? false : undefined;
  const fastMode = caps.supportsFastMode && modelOptions?.fastMode === true ? true : undefined;
  const nextOptions: ClaudeModelOptions = {
    ...(thinking === false ? { thinking: false } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode ? { fastMode: true } : {}),
    ...(autoCompactWindow ? { autoCompactWindow } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function resolveApiModelId(modelSelection: ModelSelection): string {
  if (
    modelSelection.provider === "claudeAgent" &&
    normalizeClaudeModelOptions(modelSelection.model, modelSelection.options)?.autoCompactWindow ===
      "1m" &&
    getClaudeContextWindowSuffix(modelSelection.model) === null
  ) {
    return `${modelSelection.model}[1m]`;
  }
  return modelSelection.model;
}

/**
 * Map a requested Claude Code effort to the API effort passed at session spawn.
 * `ultrathink` is prompt-injected (no API effort); `ultracode` runs as xhigh plus
 * the `ultracode` session setting.
 */
export function getEffectiveClaudeCodeEffort(
  effort: ClaudeCodeEffort | null | undefined,
): ClaudeApiEffort | null {
  if (!effort || effort === "ultrathink") {
    return null;
  }
  return effort === "ultracode" ? "xhigh" : effort;
}

interface ClaudeSpawnProfile {
  readonly maxEffort: boolean;
  readonly autoCompactWindow: string | undefined;
}

// Claude's live flag settings do not refresh the runtime auto-compaction window.
// Keep this profile aligned with the adapter's normalized spawn settings.
function claudeSpawnProfile(selection: Extract<ModelSelection, { provider: "claudeAgent" }>) {
  const caps = getModelCapabilities("claudeAgent", selection.model);
  const requestedEffort = trimOrNull(selection.options?.effort ?? null);
  const effort = requestedEffort && hasEffortLevel(caps, requestedEffort) ? requestedEffort : null;
  return {
    maxEffort: getEffectiveClaudeCodeEffort(effort) === "max",
    autoCompactWindow: normalizeClaudeModelOptions(selection.model, selection.options)
      ?.autoCompactWindow,
  } satisfies ClaudeSpawnProfile;
}

/** Restart only for spawn-fixed settings; resume preserves identity, not guaranteed cache hits. */
export function claudeSelectionRequiresRestart(
  previous: ModelSelection | undefined,
  next: ModelSelection,
): boolean {
  if (next.provider !== "claudeAgent") {
    return false;
  }
  if (previous === undefined) {
    // First observation in this process: the live session was started from the
    // same selection source, so treat it as unchanged rather than replaying.
    return false;
  }
  if (previous.provider !== "claudeAgent") {
    return true;
  }
  // Normalize against each model before deciding a model-only switch is live:
  // a persisted `max` request may become spawn-fixed (or stop being so) as the
  // selected model's capabilities change.
  const prev = claudeSpawnProfile(previous);
  const desired = claudeSpawnProfile(next);
  return (
    prev.maxEffort !== desired.maxEffort || prev.autoCompactWindow !== desired.autoCompactWindow
  );
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}
