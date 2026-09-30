import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { FastModeIcon, FastModeOutlineIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import {
  getComposerTraitSelection,
  resolveComposerTraitStatusLabel,
  showsComposerFastModeBadge,
  supportsComposerFastModeControl,
} from "./composerTraits";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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

export function FastModeToggle({
  enabled,
  onToggle,
  tone: toneProp,
}: {
  enabled: boolean;
  onToggle: () => void;
  tone?: "muted" | "accent";
}) {
  const tone = toneProp ?? "muted";
  const Icon = enabled ? FastModeIcon : FastModeOutlineIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Fast mode"
            aria-pressed={enabled}
            className={cn(
              "flex shrink-0 cursor-pointer items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-border-focus)]/60",
              tone === "accent" ? "size-6 rounded-lg" : "-my-1 size-5 rounded-md",
            )}
            onClick={onToggle}
          />
        }
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5",
            enabled
              ? tone === "accent"
                ? "text-[var(--color-text-accent)]"
                : "text-[hsl(var(--chart-4))]"
              : "text-muted-foreground/70",
          )}
        />
      </TooltipTrigger>
      <TooltipPopup side="top" variant="picker">
        {enabled ? "Fast mode on" : "Fast mode off"}
      </TooltipPopup>
    </Tooltip>
  );
}
