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
      selection.effort
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
  selection: Pick<ComposerTraitSelection, "caps" | "fastModeDescriptor" | "fastModeEnabled">,
): boolean {
  return supportsComposerFastModeControl(selection) && selection.fastModeEnabled;
}

export function hasVisibleComposerTraitControls(
  selection: Pick<ComposerTraitSelection, "descriptors">,
  options?: { includeFastMode?: boolean; includeEffort?: boolean },
): boolean {
  return selection.descriptors.some(
    (descriptor) =>
      (options?.includeFastMode !== false || descriptor.id !== "fastMode") &&
      (options?.includeEffort !== false || descriptor.type !== "select"),
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

export function resolveComposerEffortLadderIndex(
  selection: Pick<ComposerTraitSelection, "effort" | "effortLevels">,
): number {
  return Math.max(
    0,
    selection.effortLevels.findIndex((option) => option.value === selection.effort),
  );
}
