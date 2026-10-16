import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { SERIES_COLORS } from "~/lib/chartSeriesColors";

export const PROVIDER_CHART_COLORS: Readonly<Record<ProviderKind, string>> = {
  claudeAgent: SERIES_COLORS[1],
  codex: SERIES_COLORS[2],
  opencode: SERIES_COLORS[3],
  grok: SERIES_COLORS[4],
  cursor: SERIES_COLORS[0],
};
