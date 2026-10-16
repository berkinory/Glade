import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";

import { useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { Checkbox } from "../ui/checkbox";
import { DisclosureRegion } from "../ui/DisclosureRegion";

// Null means every agent, including ones added later.
export type AgentTarget = ReadonlyArray<ProviderKind> | null;

export function AgentTargetPicker(props: {
  readonly value: AgentTarget;
  readonly onChange: (value: AgentTarget) => void;
  readonly disabled?: boolean;
}) {
  const { settings } = useAppSettings();
  const available = DEFAULT_PROVIDER_ORDER.filter(
    (provider) => !settings.disabledProviders.includes(provider),
  );
  const all = props.value === null;
  const toggle = (provider: ProviderKind, checked: boolean) => {
    const current = props.value ?? available;
    props.onChange(
      checked
        ? DEFAULT_PROVIDER_ORDER.filter((entry) => entry === provider || current.includes(entry))
        : current.filter((entry) => entry !== provider),
    );
  };
  return (
    <fieldset className="flex flex-col gap-2" disabled={props.disabled}>
      <legend className="sr-only">Agents</legend>
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={all}
          disabled={props.disabled}
          onCheckedChange={(checked) => props.onChange(checked === true ? null : available)}
        />
        <span className="min-w-0">
          <span className="block text-ui font-medium text-foreground">Use in all agents</span>
          <span className="block text-ui-sm text-muted-foreground">
            Every agent, including ones you add later.
          </span>
        </span>
      </label>
      <DisclosureRegion open={!all}>
        <div className="ml-6.5 flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
          {available.map((provider) => (
            <label key={provider} className="flex cursor-pointer items-center gap-2 text-ui">
              <Checkbox
                checked={all || props.value?.includes(provider) === true}
                disabled={props.disabled}
                onCheckedChange={(checked) => toggle(provider, checked === true)}
              />
              <ProviderIcon provider={provider} className="size-3.5" />
              {PROVIDER_DISPLAY_NAMES[provider]}
            </label>
          ))}
        </div>
      </DisclosureRegion>
    </fieldset>
  );
}
