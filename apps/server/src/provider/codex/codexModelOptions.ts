import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@glade/shared/provider/model";

export interface CodexModelOptions {
  readonly reasoningEffort?: string;
  readonly serviceTier?: string;
  readonly fastMode?: boolean;
}

export function codexModelOptions(modelSelection: ModelSelection | undefined): CodexModelOptions {
  if (modelSelection?.provider !== "codex") return {};
  const reasoningEffort = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
  const serviceTier = getModelSelectionStringOptionValue(modelSelection, "serviceTier");
  const fastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  };
}

export function resolveCodexServiceTier(
  modelSelection: ModelSelection | undefined,
): string | undefined {
  const { serviceTier, fastMode } = codexModelOptions(modelSelection);
  if (serviceTier !== undefined) return serviceTier;
  if (fastMode === undefined) return undefined;
  return fastMode ? "fast" : "default";
}
