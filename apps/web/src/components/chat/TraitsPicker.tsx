import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { type ProviderOptions } from "../../providerModelOptions";
import {
  getComposerTraitSelection,
  resolveComposerTraitStatusLabel,
  showsComposerFastModeBadge,
  supportsComposerFastModeControl,
} from "./composerTraits";

export function resolveTraitsTriggerSummary(options: {
  provider: ProviderKind;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
}): {
  primaryLabel: string | null;
  showsFastBadge: boolean;
  summaryText: string;
} {
  const selection = getComposerTraitSelection(
    options.provider,
    options.model,
    options.prompt,
    options.modelOptions,
    options.runtimeModel,
  );
  const { effortLevels, thinkingEnabled, fastModeEnabled } = selection;
  const isFastOnlyControl =
    supportsComposerFastModeControl(selection) &&
    effortLevels.length === 0 &&
    thinkingEnabled === null;
  const primaryLabel =
    resolveComposerTraitStatusLabel(selection) ??
    (isFastOnlyControl ? (fastModeEnabled ? "Fast" : "Default") : null);
  const showsFastBadge = showsComposerFastModeBadge(selection) && !isFastOnlyControl;
  const summaryText = [primaryLabel, showsFastBadge ? "Fast" : null].filter(Boolean).join(" · ");

  return {
    primaryLabel: primaryLabel,
    showsFastBadge,
    summaryText,
  };
}
