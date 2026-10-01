import type { ProviderUsageDisplayRow } from "~/lib/providerUsageDisplay";

export interface EnvironmentProviderUsageSummary {
  readonly rows: ReadonlyArray<ProviderUsageDisplayRow>;
  readonly ariaLabel: string;
}

export function resolveEnvironmentProviderUsageSummary(input: {
  readonly providerName: string;
  readonly rows: ReadonlyArray<ProviderUsageDisplayRow>;
}): EnvironmentProviderUsageSummary {
  const rowSummary = input.rows
    .map((row) => `${row.label} ${row.remainingLabel} remaining`)
    .join(", ");

  return {
    rows: input.rows,
    ariaLabel: `${input.providerName} usage: ${rowSummary}`,
  };
}
