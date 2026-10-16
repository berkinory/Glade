import { ProviderIcon } from "~/components/ProviderIcon";
import {
  formatProviderModelOptionName,
  formatProviderScopedModelName,
} from "~/providerModelOptions";
import { DitherBar } from "./DitherBar";
import { formatCompact } from "./profileFormatting";
import type { ProfileModelShare } from "./profileSelectors";
import { PROVIDER_CHART_COLORS } from "./providerChartColors";

const MODEL_LIMIT = 6;

export function ModelUsageList({ models }: { readonly models: ReadonlyArray<ProfileModelShare> }) {
  const shown = models.slice(0, MODEL_LIMIT);
  const names = shown.map((entry) => formatProviderModelOptionName(entry.model));
  return (
    <ul className="flex flex-col gap-3">
      {shown.map((entry, index) => (
        <li
          key={`${entry.provider}:${entry.model}`}
          className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProviderIcon provider={entry.provider} className="size-3.5 shrink-0" />
            <span className="truncate text-ui text-foreground">
              {formatProviderScopedModelName(entry.provider, names[index]!, names)}
            </span>
          </span>
          <DitherBar
            percent={entry.percent}
            color={PROVIDER_CHART_COLORS[entry.provider]}
            className="h-2"
          />
          <span className="text-end text-ui text-foreground tabular-nums">
            {formatPercent(entry.percent)}
          </span>
          <span className="text-ui-xs text-muted-foreground tabular-nums">
            {formatCompact(entry.tokens)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Whole percents, with one decimal below 1% and two when one would still read as zero.
function formatPercent(percent: number): string {
  if (percent >= 1) {
    return `${Math.round(percent)}%`;
  }
  return `${percent.toFixed(percent >= 0.05 ? 1 : 2)}%`;
}
