import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

import { ProviderIcon } from "~/components/ProviderIcon";
import { providerNames } from "~/lib/providerNames";

// The agents that keep something, as overlapping provider icons.
export function ProviderStack(props: { readonly providers: ReadonlyArray<ProviderKind> }) {
  if (props.providers.length === 0) return null;
  const label = `In ${providerNames(props.providers)}`;
  return (
    <span
      className="inline-flex shrink-0 items-center -space-x-1"
      role="img"
      aria-label={label}
      title={label}
    >
      {props.providers.map((provider) => (
        <span
          key={provider}
          className="inline-flex size-5 items-center justify-center rounded-full border border-background bg-background"
        >
          <ProviderIcon provider={provider} className="size-3.5" />
        </span>
      ))}
    </span>
  );
}
