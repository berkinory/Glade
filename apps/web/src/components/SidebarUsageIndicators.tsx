import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { ProviderUsageMenuControl } from "./ProviderUsageMenuControl";

export function SidebarUsageIndicators({ providers }: { providers: ReadonlyArray<ProviderKind> }) {
  if (providers.length === 0) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center",
        providers.length > 2 ? "flex-wrap gap-2 px-2 py-1" : "gap-1.5",
      )}
    >
      {providers.map((provider) => (
        <ProviderUsageMenuControl key={provider} provider={provider} surface="sidebar" />
      ))}
    </div>
  );
}
