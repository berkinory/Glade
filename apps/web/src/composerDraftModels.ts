import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  type CodexReasoningEffort,
  type ModelSlug,
  type ProviderModelOptions,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import * as Schema from "effect/Schema";

import {
  normalizeClaudeModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@glade/shared/provider/model";
import type { ComposerThreadDraftState } from "./composerDraftDomain";

export const COMPOSER_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
] as const satisfies readonly ProviderKind[];

const isProviderKind = Schema.is(ProviderKind);

export const LegacyCodexFields = Schema.Struct({
  effort: Schema.optionalKey(Schema.String),
  codexFastMode: Schema.optionalKey(Schema.Boolean),
  serviceTier: Schema.optionalKey(Schema.String),
});

export type LegacyCodexFields = typeof LegacyCodexFields.Type;

export interface EffectiveComposerModelState {
  selectedModel: ModelSlug;
  modelOptions: ProviderModelOptions | null;
}

function mergeProviderModelOptionsFromSelections(
  ...selections: ReadonlyArray<ModelSelection | null | undefined>
): ProviderModelOptions | null {
  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = {};
  for (const selection of selections) {
    if (!selection) continue;
    if (selection.options) {
      result[selection.provider] = selection.options;
    } else {
      delete result[selection.provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

function deriveEffectiveComposerModelOptions(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): ProviderModelOptions | null {
  const baseOptions = mergeProviderModelOptionsFromSelections(
    input.projectModelSelection,
    input.threadModelSelection,
  );
  const draftSelections = input.draft?.modelSelectionByProvider;
  if (!draftSelections) {
    return baseOptions;
  }

  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = baseOptions
    ? { ...baseOptions }
    : {};
  for (const [provider, selection] of Object.entries(draftSelections) as Array<
    [ProviderKind, ModelSelection | undefined]
  >) {
    if (!selection) continue;
    if (selection.options) {
      result[provider] = selection.options;
    } else {
      delete result[provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function normalizeProviderKind(value: unknown): ProviderKind | null {
  return isProviderKind(value) ? value : null;
}

function trimStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function makeModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderModelOptions[ProviderKind],
  supportsAutoMode?: boolean,
): ModelSelection {
  switch (provider) {
    case "codex":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "codex" }>["options"] }
          : {}),
      };
    case "claudeAgent":
      return {
        provider,
        model,
        ...(options
          ? {
              options: options as Extract<ModelSelection, { provider: "claudeAgent" }>["options"],
            }
          : {}),
        ...(typeof supportsAutoMode === "boolean" ? { supportsAutoMode } : {}),
      };
  }
}

export function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderKind | null,
  legacy?: LegacyCodexFields,
): ProviderModelOptions | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const codexCandidate =
    candidate?.codex && typeof candidate.codex === "object"
      ? (candidate.codex as Record<string, unknown>)
      : null;
  const claudeCandidate =
    candidate?.claudeAgent && typeof candidate.claudeAgent === "object"
      ? (candidate.claudeAgent as Record<string, unknown>)
      : null;
  const codexReasoningEffort: CodexReasoningEffort | undefined =
    trimStringOrUndefined(codexCandidate?.reasoningEffort) ??
    (provider === "codex" ? trimStringOrUndefined(legacy?.effort) : undefined);
  const codexFastMode =
    codexCandidate?.fastMode === true
      ? true
      : codexCandidate?.fastMode === false
        ? false
        : (provider === "codex" && legacy?.codexFastMode === true) ||
            (typeof legacy?.serviceTier === "string" && legacy.serviceTier === "fast")
          ? true
          : undefined;
  const codexServiceTier = trimStringOrUndefined(codexCandidate?.serviceTier);
  const codex =
    codexReasoningEffort !== undefined ||
    codexFastMode !== undefined ||
    codexServiceTier !== undefined
      ? {
          ...(codexReasoningEffort !== undefined ? { reasoningEffort: codexReasoningEffort } : {}),
          ...(codexFastMode !== undefined ? { fastMode: codexFastMode } : {}),
          ...(codexServiceTier !== undefined ? { serviceTier: codexServiceTier } : {}),
        }
      : undefined;

  const claudeThinking = booleanOrUndefined(claudeCandidate?.thinking);
  const claudeEffort = trimStringOrUndefined(claudeCandidate?.effort);
  const claudeFastMode = booleanOrUndefined(claudeCandidate?.fastMode);
  const claudeUltracode = booleanOrUndefined(claudeCandidate?.ultracode);
  const claude = normalizeClaudeModelOptions(undefined, {
    ...(claudeThinking !== undefined ? { thinking: claudeThinking } : {}),
    ...(claudeEffort !== undefined ? { effort: claudeEffort } : {}),
    ...(claudeFastMode !== undefined ? { fastMode: claudeFastMode } : {}),
    ...(claudeUltracode !== undefined ? { ultracode: claudeUltracode } : {}),
  });

  if (!codex && !claude) return null;
  return {
    ...(codex ? { codex } : {}),
    ...(claude ? { claudeAgent: claude } : {}),
  };
}

export function normalizeModelSelection(
  value: unknown,
  legacy?: {
    provider?: unknown;
    model?: unknown;
    modelOptions?: unknown;
    legacyCodex?: LegacyCodexFields;
  },
): ModelSelection | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const rawProvider = candidate?.provider ?? legacy?.provider;
  const provider = normalizeProviderKind(rawProvider);
  if (provider === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  if (typeof rawModel !== "string") {
    return null;
  }
  const model =
    normalizeModelSlug(rawModel, provider) ??
    (rawModel === "provider-default" || (provider === "claudeAgent" && rawModel === "default")
      ? rawModel
      : null);
  if (!model) {
    return null;
  }
  const modelOptions = normalizeProviderModelOptions(
    candidate?.options ? { [provider]: candidate.options } : legacy?.modelOptions,
    provider,
    provider === "codex" ? legacy?.legacyCodex : undefined,
  );
  const options = provider === "codex" ? modelOptions?.codex : modelOptions?.claudeAgent;
  return makeModelSelection(
    provider,
    model,
    options,
    provider === "claudeAgent" && typeof candidate?.supportsAutoMode === "boolean"
      ? candidate.supportsAutoMode
      : undefined,
  );
}

export function reconcileProviderScopedModelSelection(
  requested: ModelSelection,
  current: ModelSelection | null | undefined,
): ModelSelection {
  if (requested.options !== undefined || current?.provider !== requested.provider) {
    return requested;
  }
  if (current.model === requested.model) {
    const currentSupportsAutoMode =
      current.provider === "claudeAgent" ? current.supportsAutoMode : undefined;
    return makeModelSelection(
      requested.provider,
      requested.model,
      current.options,
      requested.provider === "claudeAgent"
        ? (requested.supportsAutoMode ?? currentSupportsAutoMode)
        : undefined,
    );
  }
  if (current.provider !== "codex" && current.provider !== "claudeAgent") {
    return requested;
  }
  return makeModelSelection(
    requested.provider,
    requested.model,
    current.options,
    requested.provider === "claudeAgent" ? requested.supportsAutoMode : undefined,
  );
}

export function stripNonStickyModelOptions(selection: ModelSelection): ModelSelection {
  if (
    selection.provider !== "claudeAgent" ||
    (!selection.options?.contextWindow && !selection.options?.autoCompactWindow)
  ) {
    return selection;
  }
  const {
    contextWindow: _contextWindow,
    autoCompactWindow: _autoCompactWindow,
    ...rest
  } = selection.options;
  return makeModelSelection(
    selection.provider,
    selection.model,
    Object.keys(rest).length > 0 ? rest : undefined,
    selection.supportsAutoMode,
  );
}

export function sanitizeStickyModelSelectionMap(
  map: Partial<Record<ProviderKind, ModelSelection>>,
): Partial<Record<ProviderKind, ModelSelection>> {
  const claude = map.claudeAgent;
  if (
    claude?.provider !== "claudeAgent" ||
    (!claude.options?.contextWindow && !claude.options?.autoCompactWindow)
  ) {
    return map;
  }
  return { ...map, claudeAgent: stripNonStickyModelOptions(claude) };
}

export function legacySyncModelSelectionOptions(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): ModelSelection | null {
  if (modelSelection === null) {
    return null;
  }
  const normalizedOptions = modelOptions?.[modelSelection.provider];
  return makeModelSelection(
    modelSelection.provider,
    modelSelection.model,
    normalizedOptions,
    modelSelection.provider === "claudeAgent" ? modelSelection.supportsAutoMode : undefined,
  );
}

export function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: ModelSelection | null,
  currentModelOptions: ProviderModelOptions | null | undefined,
): ProviderModelOptions | null {
  if (modelSelection?.options === undefined) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    modelSelection.provider,
    modelSelection.options,
  );
}

function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderModelOptions | null | undefined,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
): ProviderModelOptions | null {
  const { [provider]: _discardedProviderModelOptions, ...otherProviderModelOptions } =
    currentModelOptions ?? {};
  const normalizedNextProviderOptions = normalizeProviderModelOptions(
    { [provider]: nextProviderOptions },
    provider,
  );

  return normalizeProviderModelOptions({
    ...otherProviderModelOptions,
    ...(normalizedNextProviderOptions ? normalizedNextProviderOptions : {}),
  });
}

export function legacyToModelSelectionByProvider(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): Partial<Record<ProviderKind, ModelSelection>> {
  const result: Partial<Record<ProviderKind, ModelSelection>> = {};

  if (modelOptions) {
    for (const provider of COMPOSER_PROVIDER_KINDS) {
      const options = modelOptions[provider];
      if (options && Object.keys(options).length > 0) {
        const model = modelSelection?.provider === provider ? modelSelection.model : "";
        if (model) {
          result[provider] = makeModelSelection(provider, model, options);
        }
      }
    }
  }

  if (modelSelection) {
    result[modelSelection.provider] = modelSelection;
  }
  return result;
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  selectedProvider: ProviderKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  availableModelOptionsByProvider?: Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string; isDefault?: boolean }>>
  >;
}): EffectiveComposerModelState {
  const candidate =
    input.draft?.modelSelectionByProvider?.[input.selectedProvider]?.model ??
    (input.threadModelSelection?.provider === input.selectedProvider
      ? input.threadModelSelection.model
      : null) ??
    (input.projectModelSelection?.provider === input.selectedProvider
      ? input.projectModelSelection.model
      : null);
  const selectedModel =
    resolveSelectableModel(
      input.selectedProvider,
      candidate,
      input.availableModelOptionsByProvider?.[input.selectedProvider] ?? [],
    ) ??
    normalizeModelSlug(candidate, input.selectedProvider) ??
    "";
  const modelOptions = deriveEffectiveComposerModelOptions(input);

  return {
    selectedModel,
    modelOptions,
  };
}

export function resolvePreferredComposerModelSelection(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  defaultProvider?: ProviderKind | null | undefined;
}): ModelSelection {
  const draftProviderWithSelection =
    COMPOSER_PROVIDER_KINDS.find(
      (provider) => input.draft?.modelSelectionByProvider?.[provider] !== undefined,
    ) ?? null;
  const preferredProvider =
    input.draft?.activeProvider ??
    draftProviderWithSelection ??
    input.threadModelSelection?.provider ??
    input.projectModelSelection?.provider ??
    input.defaultProvider ??
    "codex";

  const persistedSelection =
    (input.threadModelSelection?.provider === preferredProvider
      ? input.threadModelSelection
      : null) ??
    (input.projectModelSelection?.provider === preferredProvider
      ? input.projectModelSelection
      : null);
  const draftSelection = input.draft?.modelSelectionByProvider?.[preferredProvider] ?? null;

  return draftSelection ?? persistedSelection ?? { provider: preferredProvider, model: "" };
}
