import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest,
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
// left out: Glade always runs the agent's normal working mode. Settings take Glade's shared ids, so
// every provider's effort, thinking and fast controls work the same: a reasoning level is `effort`,
// an on/off reasoning switch is `thinking`, and an on/off `fast` option is `fastMode`.
const THOUGHT_LEVEL = "thought_level";
// "Let the agent decide" is not a rung of the effort ladder.
const AGENT_DEFAULT_EFFORT_VALUES = new Set(["default", "auto"]);
const NATIVE_FAST_OPTION_ID = "fast";

// Agents without boolean options offer a switch as a select of "false" and "true".
function isOnOffSelect(option: SessionConfigOption): boolean {
  if (option.type !== "select") return false;
  const values = flattenChoices(option.options)
    .map((choice) => choice.value)
    .toSorted();
  return values.length === 2 && values[0] === "false" && values[1] === "true";
}

function gladeOptionId(option: SessionConfigOption): string | undefined {
  if (option.category === "model" || option.category === "mode") return undefined;
  const onOff = option.type === "boolean" || isOnOffSelect(option);
  if (option.category === THOUGHT_LEVEL) return onOff ? "thinking" : "effort";
  return onOff && option.id === NATIVE_FAST_OPTION_ID ? "fastMode" : option.id;
}

// The agent's config id and value for a Glade setting, when the agent offers that value.
export function acpConfigValue(
  options: ReadonlyArray<SessionConfigOption>,
  optionId: string,
  value: string | boolean,
): { readonly configId: string; readonly value: string | boolean } | undefined {
  const option = options.find((entry) => gladeOptionId(entry) === optionId);
  if (!option) return undefined;
  if (option.type === "boolean") {
    return typeof value === "boolean" ? { configId: option.id, value } : undefined;
  }
  if (option.type !== "select") return undefined;
  const native = typeof value === "boolean" ? String(value) : value;
  return flattenChoices(option.options).some((choice) => choice.value === native)
    ? { configId: option.id, value: native }
    : undefined;
}

export function acpSetConfigRequest(
  sessionId: string,
  configId: string,
  value: string | boolean,
): SetSessionConfigOptionRequest {
  return typeof value === "boolean"
    ? { sessionId, configId, type: "boolean", value }
    : { sessionId, configId, value };
}

function optionDescriptors(
  options: ReadonlyArray<SessionConfigOption>,
): ReadonlyArray<ProviderOptionDescriptor> {
  const seen = new Set<string>();
  return options.flatMap((option): ProviderOptionDescriptor[] => {
    const id = gladeOptionId(option);
    if (id === undefined || seen.has(id)) return [];
    seen.add(id);
    const label = trimmed(option.name) ?? option.id;
    const description = trimmed(option.description);
    if (option.type === "boolean" || isOnOffSelect(option)) {
      return [
        {
          id,
          label,
          ...(description ? { description } : {}),
          type: "boolean",
          currentValue: option.currentValue === true || option.currentValue === "true",
        },
      ];
    }
    if (option.type !== "select") return [];
    const effort = id === "effort";
    const choices = flattenChoices(option.options).flatMap((choice) => {
      if (effort && AGENT_DEFAULT_EFFORT_VALUES.has(choice.value)) return [];
      const name = trimmed(choice.name);
      // Agents that only capitalize the raw value ("Xhigh") get Glade's effort wording.
      const choiceLabel =
        effort && (!name || name.toLowerCase() === choice.value.toLowerCase())
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
            id,
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

export function acpModelOption(
  options: ReadonlyArray<SessionConfigOption>,
): Extract<SessionConfigOption, { type: "select" }> | undefined {
  const option = options.find((entry) => entry.category === "model" && entry.type === "select");
  return option?.type === "select" ? option : undefined;
}

export function acpModelSlugs(options: ReadonlyArray<SessionConfigOption>): ReadonlyArray<string> {
  const modelOption = acpModelOption(options);
  return modelOption ? flattenChoices(modelOption.options).map((choice) => choice.value) : [];
}

// An agent reports the settings of its current model only, so each model's settings come from the
// options the agent returned while that model was selected, or from the agent's own model list. A
// model with none known has none.
export function acpModelCatalog(
  options: ReadonlyArray<SessionConfigOption>,
  optionsByModel: ReadonlyMap<string, ReadonlyArray<SessionConfigOption>>,
  modelVendor?: AcpProviderProfile["modelVendor"],
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
    const namedVendor = separator > 0 ? label.slice(0, separator).trim() : undefined;
    const name = separator > 0 ? label.slice(separator + 1).trim() || label : label;
    const upstreamProviderName = choice.groupName ?? namedVendor ?? modelVendor?.(slug);
    return [
      {
        slug,
        name,
        ...(description ? { description } : {}),
        ...(choice.value === modelOption.currentValue ? { isDefault: true } : {}),
        ...(upstreamProviderName ? { upstreamProviderName } : {}),
        ...(descriptors.length > 0 ? { optionDescriptors: descriptors } : {}),
      },
    ];
  });
}
