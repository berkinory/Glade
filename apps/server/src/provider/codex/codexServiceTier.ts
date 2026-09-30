import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";

export function resolveCodexServiceTier(
  modelSelection: ModelSelection | undefined,
): "fast" | "default" | undefined {
  if (modelSelection?.provider !== "codex" || modelSelection.options?.fastMode === undefined) {
    return undefined;
  }

  return modelSelection.options.fastMode ? "fast" : "default";
}
