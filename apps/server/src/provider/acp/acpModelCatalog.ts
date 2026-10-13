import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import type { ProviderOptionDescriptor } from "@glade/contracts/provider/model";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";

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
    const choices = flattenChoices(option.options).flatMap((choice) => {
      const choiceLabel = trimmed(choice.name);
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
            id: option.id,
            label,
            ...(description ? { description } : {}),
            type: "select",
            options: choices,
            ...(trimmed(option.currentValue) ? { currentValue: option.currentValue } : {}),
          },
        ]
      : [];
  });
}

export function acpModelCatalog(
  options: ReadonlyArray<SessionConfigOption>,
): ReadonlyArray<ProviderModelDescriptor> {
  const modelOption = options.find(
    (option) => option.category === "model" && option.type === "select",
  );
  if (!modelOption || modelOption.type !== "select") return [];
  const descriptors = optionDescriptors(options);
  return flattenChoices(modelOption.options).flatMap((choice) => {
    const slug = trimmed(choice.value);
    if (!slug) return [];
    const description = trimmed(choice.description);
    return [
      {
        slug,
        name: trimmed(choice.name) ?? slug,
        ...(description ? { description } : {}),
        ...(choice.value === modelOption.currentValue ? { isDefault: true } : {}),
        ...(choice.groupName ? { upstreamProviderName: choice.groupName } : {}),
        ...(descriptors.length > 0 ? { optionDescriptors: descriptors } : {}),
      },
    ];
  });
}
