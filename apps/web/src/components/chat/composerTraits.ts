import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import type { ProviderOptionDescriptor } from "@glade/contracts/provider/model";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { getProviderOptionDescriptors } from "@glade/shared/provider/model";
import { buildProviderOptionPatch, type ProviderOptions } from "../../providerModelOptions";
import { getRuntimeAwareModelCapabilities } from "./runtimeModelCapabilities";

export function getComposerTraitSelection(
  provider: ProviderKind,
  model: string | null | undefined,
  _prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  runtimeModel?: ProviderModelDescriptor,
) {
  const caps = getRuntimeAwareModelCapabilities({ provider, model, runtimeModel });
  const descriptors = getProviderOptionDescriptors({ provider, caps, selections: modelOptions });
  const primarySelectDescriptor =
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
        descriptor.type === "select" &&
        (descriptor.id === "effort" || descriptor.id === "reasoningEffort"),
    ) ?? null;
  const fastModeDescriptor = descriptors.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const thinkingDescriptor = descriptors.find((descriptor) => descriptor.id === "thinking") ?? null;
  const effortLevels =
    primarySelectDescriptor?.options.map((option) => ({
      value: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(option.isDefault ? { isDefault: true as const } : {}),
    })) ?? [];
  const defaultEffort = effortLevels.find((option) => option.isDefault)?.value ?? null;
  const effort = primarySelectDescriptor?.currentValue ?? defaultEffort;
  const thinkingEnabled =
    thinkingDescriptor?.type === "boolean" ? (thinkingDescriptor.currentValue ?? null) : null;
  return {
    caps,
    descriptors,
    primarySelectDescriptor,
    fastModeDescriptor,
    thinkingDescriptor,
    defaultEffort,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled: fastModeDescriptor?.currentValue === true,
  };
}

export type ComposerTraitSelection = ReturnType<typeof getComposerTraitSelection>;

export function resolveComposerTraitStatusLabel(
  selection: Pick<ComposerTraitSelection, "effort" | "effortLevels" | "thinkingEnabled">,
): string | null {
  if (selection.effort)
    return (
      selection.effortLevels.find((option) => option.value === selection.effort)?.label ??
      formatEffortLabel(selection.effort)
    );
  return selection.thinkingEnabled === null
    ? null
    : `Thinking ${selection.thinkingEnabled ? "On" : "Off"}`;
}

export function supportsComposerFastModeControl(
  selection: Pick<ComposerTraitSelection, "caps" | "fastModeDescriptor">,
): boolean {
  return selection.fastModeDescriptor !== null;
}

export function showsComposerFastModeBadge(
  selection: Pick<
    ComposerTraitSelection,
    "caps" | "descriptors" | "fastModeDescriptor" | "fastModeEnabled"
  >,
): boolean {
  return (
    (supportsComposerFastModeControl(selection) && selection.fastModeEnabled) ||
    selection.descriptors.some(
      (descriptor) =>
        descriptor.id === "serviceTier" &&
        (descriptor.currentValue === "priority" || descriptor.currentValue === "fast"),
    )
  );
}

export type ComposerEffortChangePlan = {
  readonly kind: "options";
  readonly patch: Record<string, unknown>;
};

export function planComposerEffortChange(input: {
  provider: ProviderKind;
  selection: Pick<ComposerTraitSelection, "effortLevels" | "primarySelectDescriptor">;
  prompt: string;
  value: string;
}): ComposerEffortChangePlan | null {
  const descriptor = input.selection.primarySelectDescriptor;
  if (!descriptor || !input.selection.effortLevels.some((option) => option.value === input.value))
    return null;
  return {
    kind: "options",
    patch: buildProviderOptionPatch(input.provider, descriptor.id, input.value),
  };
}

const effortRanks: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 5,
};

export function matchComposerEffort(
  effort: string | null,
  target: Pick<ComposerTraitSelection, "effortLevels" | "defaultEffort">,
): string | null {
  if (target.effortLevels.some((level) => level.value === effort)) return effort;
  const rank = effort === null ? undefined : effortRanks[effort];
  if (rank === undefined) return target.defaultEffort;
  let closest: string | null = null;
  let distance = Infinity;
  let closestRank = Infinity;
  for (const level of target.effortLevels) {
    const candidateRank = effortRanks[level.value];
    if (candidateRank === undefined) continue;
    const candidateDistance = Math.abs(candidateRank - rank);
    // Prefer the lower effort on a tie instead of silently increasing cost.
    if (
      candidateDistance < distance ||
      (candidateDistance === distance && candidateRank < closestRank)
    ) {
      closest = level.value;
      distance = candidateDistance;
      closestRank = candidateRank;
    }
  }
  return closest ?? target.defaultEffort;
}

export function resolveComposerEffortLadderIndex(
  selection: Pick<ComposerTraitSelection, "effort" | "effortLevels">,
): number {
  return Math.max(
    0,
    selection.effortLevels.findIndex((option) => option.value === selection.effort),
  );
}

export function resolveComposerModelOptions(
  options: ProviderOptions | null | undefined,
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ProviderOptions | undefined {
  if (!options) return undefined;
  const next = { ...options };
  for (const id of ["effort", "reasoningEffort", "thinking", "fastMode", "serviceTier"] as const) {
    const value = next[id as keyof ProviderOptions];
    if (value === undefined) continue;
    const descriptor = descriptors.find((candidate) => candidate.id === id);
    const supported =
      descriptor?.type === "boolean"
        ? typeof value === "boolean"
        : descriptor?.type === "select" && descriptor.options.some((option) => option.id === value);
    if (!supported) delete next[id as keyof ProviderOptions];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
