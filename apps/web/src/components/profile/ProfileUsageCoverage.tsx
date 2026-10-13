import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";

export function ProfileUsageCoverage({
  unavailableProviders,
  className = "text-ui leading-snug text-muted-foreground",
}: {
  readonly unavailableProviders: ReadonlyArray<ProviderKind>;
  readonly className?: string;
}) {
  if (unavailableProviders.length === 0) {
    return null;
  }
  return (
    <p className={className}>
      Token usage is unavailable or zero for{" "}
      {unavailableProviders.map((provider) => PROVIDER_DISPLAY_NAMES[provider]).join(", ")}.
      Percentages reflect tracked tokens only. Their turns still count toward activity totals.
    </p>
  );
}
