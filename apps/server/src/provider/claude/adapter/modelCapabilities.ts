import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import {
  getClaudeContextWindowSuffix,
  stripClaudeContextWindowSuffix,
  getModelCapabilities,
  getProviderOptionDescriptors,
} from "@glade/shared/provider/model";
import {
  CLAUDE_CONTEXT_WINDOW_MAX_TOKENS,
  resolveClaudeEffectiveContextBudget,
} from "../claudeTokenUsage.ts";
import { asNonBlankString } from "@glade/shared/text/text";
import { type ProviderListModelsResult } from "@glade/contracts/provider/providerDiscovery";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";

type ClaudeAutoModeModelResolution =
  | { readonly status: "matched"; readonly model: ModelInfo }
  | { readonly status: "absent" }
  | { readonly status: "conflicting" };

function stripSupportedClaudeContextWindowQualifier(modelId: string): string {
  const qualifier = getClaudeContextWindowSuffix(modelId);
  return qualifier && Object.hasOwn(CLAUDE_CONTEXT_WINDOW_MAX_TOKENS, qualifier)
    ? stripClaudeContextWindowSuffix(modelId)
    : modelId;
}

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

  const unqualifiedRequestedModelIds = new Set(
    [...requestedModelIds].filter(
      (modelId) => stripSupportedClaudeContextWindowQualifier(modelId) === modelId,
    ),
  );
  const normalizedMatches = discoveredModels.filter((model) =>
    claudeModelIdentifiers(model).some((identifier) =>
      unqualifiedRequestedModelIds.has(stripSupportedClaudeContextWindowQualifier(identifier)),
    ),
  );
  const firstMatch = normalizedMatches[0];
  if (!firstMatch) {
    return { status: "absent" };
  }
  if (normalizedMatches.some((model) => model.supportsAutoMode !== firstMatch.supportsAutoMode)) {
    return { status: "conflicting" };
  }
  return { status: "matched", model: firstMatch };
}

export function claudeEffectiveContextBudget(context: ClaudeSessionContext): number | undefined {
  return resolveClaudeEffectiveContextBudget(
    context.lastKnownAutoCompactThreshold,
    context.currentAutoCompactWindow,
    context.lastKnownContextWindow,
  );
}

interface ClaudeModelRefusalFallback {
  readonly originalModel: string;
  readonly fallbackModel: string;
  readonly content?: string;
}

export function readClaudeModelRefusalFallback(
  message: unknown,
): ClaudeModelRefusalFallback | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const record = message as {
    type?: unknown;
    subtype?: unknown;
    original_model?: unknown;
    fallback_model?: unknown;
    originalModel?: unknown;
    fallbackModel?: unknown;
    content?: unknown;
  };
  if (record.type !== "system" || record.subtype !== "model_refusal_fallback") {
    return undefined;
  }

  const originalModel =
    asNonBlankString(record.original_model) ?? asNonBlankString(record.originalModel);
  const fallbackModel =
    asNonBlankString(record.fallback_model) ?? asNonBlankString(record.fallbackModel);
  if (!originalModel || !fallbackModel) {
    return undefined;
  }
  return {
    originalModel,
    fallbackModel,
    ...(typeof record.content === "string" && record.content.trim().length > 0
      ? { content: record.content }
      : {}),
  };
}

export function resolveSelectedClaudeThinkingToggle(
  model: string | null | undefined,
  selectedThinking: boolean | null | undefined,
): boolean | undefined {
  if (typeof selectedThinking !== "boolean") {
    return undefined;
  }
  return getModelCapabilities("claudeAgent", model).supportsThinkingToggle
    ? selectedThinking
    : undefined;
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
  const optionDescriptors = getProviderOptionDescriptors({
    provider: PROVIDER,
    caps: getModelCapabilities(PROVIDER, model.resolvedModel ?? model.value),
  });
  return {
    slug: model.value,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    name: model.displayName,
    ...(optionDescriptors.length > 0 ? { optionDescriptors } : {}),
    ...(typeof model.supportsAutoMode === "boolean"
      ? { supportsAutoMode: model.supportsAutoMode }
      : {}),
  };
}
