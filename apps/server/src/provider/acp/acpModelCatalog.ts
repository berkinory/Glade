import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import type { ProviderOptionDescriptor } from "@glade/contracts/provider/model";
import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";

import type { AcpProviderProfile } from "./acpProviderProfile.ts";

function flattenChoices(
  options: ReadonlyArray<SessionConfigSelectOption> | ReadonlyArray<SessionConfigSelectGroup>,
): ReadonlyArray<SessionConfigSelectOption & { readonly groupName?: string }> {
  return options.flatMap((entry) =>
    "group" in entry
      ? entry.options.map((option) => ({ ...option, groupName: entry.name }))
      : [entry],
  );
}

const trimmed = (value: string | null | undefined) => {
  const text = value?.trim();
  return text ? text : undefined;
};

// The agent's session config options describe its models and their settings. Mode options are
// left out: Glade always runs the agent's normal working mode.
// The agent's reasoning level is offered under Glade's effort id, so every provider's effort picker
// works the same; `acpConfigIdFor` maps it back to the agent's own id.
const ACP_EFFORT_OPTION_ID = "effort";
const THOUGHT_LEVEL = "thought_level";
// "Let the agent decide" is not a rung of the effort ladder.
const AGENT_DEFAULT_EFFORT_VALUES = new Set(["default", "auto"]);

export function acpConfigIdFor(
  options: ReadonlyArray<SessionConfigOption>,
  optionId: string,
): string | undefined {
  if (optionId === ACP_EFFORT_OPTION_ID) {
    return (
      options.find((option) => option.category === THOUGHT_LEVEL)?.id ??
      options.find((option) => option.id === optionId)?.id
    );
  }
  return options.find((option) => option.id === optionId && option.category !== THOUGHT_LEVEL)?.id;
}

function optionDescriptors(
  options: ReadonlyArray<SessionConfigOption>,
): ReadonlyArray<ProviderOptionDescriptor> {
  return options.flatMap((option): ProviderOptionDescriptor[] => {
    if (option.category === "model" || option.category === "mode") return [];
    const label = trimmed(option.name) ?? option.id;
    const description = trimmed(option.description);
    if (option.type === "boolean") {
      return [
        {
          id: option.id,
          label,
          ...(description ? { description } : {}),
          type: "boolean",
          currentValue: option.currentValue,
        },
      ];
    }
    const effort = option.category === THOUGHT_LEVEL;
    const choices = flattenChoices(option.options).flatMap((choice) => {
      if (effort && AGENT_DEFAULT_EFFORT_VALUES.has(choice.value)) return [];
      const name = trimmed(choice.name);
      // Agents that only capitalize the raw value ("Xhigh") get Glade's effort wording.
      const choiceLabel =
        effort && name?.toLowerCase() === choice.value.toLowerCase()
          ? formatEffortLabel(choice.value)
          : name;
      return trimmed(choice.value) && choiceLabel
        ? [
            {
              id: choice.value,
              label: choiceLabel,
              ...(trimmed(choice.description) ? { description: choice.description!.trim() } : {}),
              ...(choice.value === option.currentValue ? { isDefault: true as const } : {}),
            },
          ]
        : [];
    });
    return choices.length > 0
      ? [
          {
            id: effort ? ACP_EFFORT_OPTION_ID : option.id,
            label,
            ...(description ? { description } : {}),
            type: "select",
            options: choices,
            ...(trimmed(option.currentValue) &&
            !AGENT_DEFAULT_EFFORT_VALUES.has(option.currentValue)
              ? { currentValue: option.currentValue }
              : {}),
          },
        ]
      : [];
  });
}

// Some agents fold a model's settings into its id, as in "model[effort=high,fast=false]"; each id is
// one fixed variant, so the settings become a readable description.
function variantDescription(slug: string): string | undefined {
  const params = /\[([^\]]*)\]$/u.exec(slug)?.[1];
  if (!params) return undefined;
  const parts = params
    .split(",")
    .map((pair) => pair.split("=").map((part) => part.trim()))
    .flatMap(([key, value]) =>
      !key || value === undefined || value === "false"
        ? []
        : [value === "true" ? formatEffortLabel(key) : `${formatEffortLabel(key)} ${value}`],
    );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function acpModelOption(
  options: ReadonlyArray<SessionConfigOption>,
): Extract<SessionConfigOption, { type: "select" }> | undefined {
  const option = options.find((entry) => entry.category === "model" && entry.type === "select");
  return option?.type === "select" ? option : undefined;
}

export function acpOffersValue(
  options: ReadonlyArray<SessionConfigOption>,
  configId: string,
  value: string,
): boolean {
  const option = options.find((entry) => entry.id === configId);
  return (
    option?.type === "select" &&
    flattenChoices(option.options).some((choice) => choice.value === value)
  );
}

export function acpModelSlugs(options: ReadonlyArray<SessionConfigOption>): ReadonlyArray<string> {
  const modelOption = acpModelOption(options);
  return modelOption ? flattenChoices(modelOption.options).map((choice) => choice.value) : [];
}

// An agent reports the settings of its current model only, so each model's settings come from the
// options the agent returned while that model was selected. A model with none known has none.
export function acpModelCatalog(
  options: ReadonlyArray<SessionConfigOption>,
  optionsByModel: ReadonlyMap<string, ReadonlyArray<SessionConfigOption>>,
  presentModel?: AcpProviderProfile["presentModel"],
): ReadonlyArray<ProviderModelDescriptor> {
  const modelOption = acpModelOption(options);
  if (!modelOption) return [];
  return flattenChoices(modelOption.options).flatMap((choice) => {
    const slug = trimmed(choice.value);
    if (!slug) return [];
    const descriptors = optionDescriptors(
      optionsByModel.get(choice.value) ??
        (choice.value === modelOption.currentValue ? options : []),
    );
    const description = trimmed(choice.description);
    // Multi-vendor agents name models "vendor/Model"; the vendor becomes the grouping label.
    const label = trimmed(choice.name) ?? slug;
    const separator = label.indexOf("/");
    const vendor = separator > 0 ? label.slice(0, separator).trim() : undefined;
    const agentName = separator > 0 ? label.slice(separator + 1).trim() || label : label;
    const presented = presentModel?.(slug, agentName);
    const name = presented?.name ?? agentName;
    const upstreamProviderName = choice.groupName ?? vendor ?? presented?.vendor;
    const variant = variantDescription(slug);
    return [
      {
        slug,
        name,
        ...((description ?? variant) ? { description: description ?? variant } : {}),
        ...(choice.value === modelOption.currentValue ? { isDefault: true } : {}),
        ...(upstreamProviderName ? { upstreamProviderName } : {}),
        ...(descriptors.length > 0 ? { optionDescriptors: descriptors } : {}),
      },
    ];
  });
}
