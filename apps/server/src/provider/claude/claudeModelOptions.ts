import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  normalizeModelSlug,
} from "@glade/shared/provider/model";

export interface ClaudeModelOptions {
  readonly effort?: string;
  readonly ultracode?: boolean;
  readonly thinking?: boolean;
  readonly fastMode?: boolean;
}

// Selections from before native effort levels stored the "ultrathink" prompt mode and the "ultracode"
// flag as effort values. Neither is an effort the SDK accepts.
export function claudeModelOptions(modelSelection: ModelSelection | undefined): ClaudeModelOptions {
  if (modelSelection?.provider !== "claudeAgent") return {};
  const storedEffort = getModelSelectionStringOptionValue(modelSelection, "effort");
  const effort =
    storedEffort === "ultrathink" || storedEffort === "ultracode" ? undefined : storedEffort;
  const ultracode =
    getModelSelectionBooleanOptionValue(modelSelection, "ultracode") ??
    (storedEffort === "ultracode" ? true : undefined);
  const thinking = getModelSelectionBooleanOptionValue(modelSelection, "thinking");
  const fastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
  return {
    ...(effort !== undefined ? { effort } : {}),
    ...(ultracode !== undefined ? { ultracode } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  };
}

export function resolveClaudeApiModelId(modelSelection: ModelSelection): string | undefined {
  return normalizeModelSlug(modelSelection.model, modelSelection.provider) ?? undefined;
}
