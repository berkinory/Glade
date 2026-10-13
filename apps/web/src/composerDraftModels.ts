import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  type ModelSlug,
  type ProviderModelOptions,
  type ProviderOptionSelections,
  type ProviderOptionValue,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import * as Schema from "effect/Schema";

import {
  normalizeModelSlug,
  resolveSelectableModel,
  trimOrNull,
} from "@glade/shared/provider/model";
import type { ComposerThreadDraftState } from "./composerDraftDomain";
import { buildModelSelection } from "./providerModelOptions";
import { DEFAULT_PROVIDER_ORDER } from "./providerOrdering";

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

function deriveEffectiveComposerModelOptions(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): ProviderModelOptions | null {
  const result: Partial<Record<ProviderKind, ProviderOptionSelections>> = {};
  for (const selection of [
    input.projectModelSelection,
    input.threadModelSelection,
    ...Object.values(input.draft?.modelSelectionByProvider ?? {}),
  ]) {
    if (!selection) continue;
    if (selection.options) {
      result[selection.provider] = selection.options;
    } else {
      delete result[selection.provider];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function normalizeProviderKind(value: unknown): ProviderKind | null {
  return isProviderKind(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Blank strings mean unset, and values outside the contract's option value types are dropped.
export function normalizeProviderOptionSelections(
  value: unknown,
): ProviderOptionSelections | undefined {
  const result: Record<string, ProviderOptionValue> = {};
  for (const [id, raw] of Object.entries(asRecord(value) ?? {})) {
    const normalized = typeof raw === "string" ? trimOrNull(raw) : raw;
    if (typeof normalized === "string" || typeof normalized === "boolean") result[id] = normalized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// The oldest drafts kept Codex settings at the top level of the draft instead of in its options.
function withLegacyCodexOptions(
  options: ProviderOptionSelections | undefined,
  legacy: LegacyCodexFields | undefined,
): ProviderOptionSelections | undefined {
  const reasoningEffort = trimOrNull(legacy?.effort);
  const fastMode = legacy?.codexFastMode === true || legacy?.serviceTier === "fast";
  const merged = {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(fastMode ? { fastMode } : {}),
    ...options,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
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
  const candidate = asRecord(value);
  const provider = normalizeProviderKind(candidate?.provider ?? legacy?.provider);
  if (provider === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  const model = typeof rawModel === "string" ? trimOrNull(rawModel) : null;
  if (!model) {
    return null;
  }
  const options = normalizeProviderOptionSelections(
    candidate?.options ?? asRecord(legacy?.modelOptions)?.[provider],
  );
  return buildModelSelection(
    provider,
    model,
    provider === "codex" ? withLegacyCodexOptions(options, legacy?.legacyCodex) : options,
    typeof candidate?.supportsAutoMode === "boolean" ? candidate.supportsAutoMode : undefined,
  );
}

export function reconcileProviderScopedModelSelection(
  requested: ModelSelection,
  current: ModelSelection | null | undefined,
): ModelSelection {
  if (requested.options !== undefined || current?.provider !== requested.provider) {
    return requested;
  }
  return buildModelSelection(
    requested.provider,
    requested.model,
    current.options,
    current.model === requested.model
      ? (requested.supportsAutoMode ?? current.supportsAutoMode)
      : requested.supportsAutoMode,
  );
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
    DEFAULT_PROVIDER_ORDER.find(
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
