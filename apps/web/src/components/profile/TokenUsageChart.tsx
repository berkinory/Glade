import { useRef } from "react";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ditherMask } from "./ditherMask";
import { formatAxisLabel, formatCompact, formatPeriodLabel } from "./profileFormatting";
import type { ProfileRangeSummary, ProfileTokenBucket } from "./profileSelectors";
import { PROVIDER_CHART_COLORS } from "./providerChartColors";
import { TokenTooltipContent } from "./TokenTooltipContent";

const BAR_DENSITY = 0.75;

type Granularity = ProfileRangeSummary["granularity"];

export function TokenUsageChart({
  buckets,
  granularity,
  providers,
}: {
  readonly buckets: ReadonlyArray<ProfileTokenBucket>;
  readonly granularity: Granularity;
  readonly providers: ReadonlyArray<ProviderKind>;
}) {
  const scaleMax = niceCeiling(Math.max(0, ...buckets.map((bucket) => bucket.total)));
  const ticks = [scaleMax, scaleMax / 2, 0];
  const middle = Math.floor((buckets.length - 1) / 2);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className="flex h-40 flex-col justify-between text-end text-ui-xs leading-none text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="-my-[0.5em]">
              {formatCompact(tick)}
            </span>
          ))}
        </div>
        <div className="relative h-40">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick) => (
              <div key={tick} className="border-t border-border/50" />
            ))}
          </div>
          <div className="relative flex h-full items-end gap-[3px]">
            {buckets.map((bucket) => (
              <BucketColumn
                key={bucket.start}
                bucket={bucket}
                scaleMax={scaleMax}
                granularity={granularity}
              />
            ))}
          </div>
        </div>
        <div />
        <div className="mt-1.5 flex justify-between text-ui-xs text-muted-foreground tabular-nums">
          {[buckets[0], buckets[middle], buckets.at(-1)].map((bucket, index) =>
            bucket && (index !== 1 || buckets.length > 2) ? (
              <span key={index}>{formatAxisLabel(bucket.start, granularity)}</span>
            ) : (
              <span key={index} />
            ),
          )}
        </div>
      </div>
      {providers.length > 0 ? (
        <ul
          className="grid gap-x-4 gap-y-1.5"
          style={{ gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))` }}
        >
          {providers.map((provider) => (
            <li
              key={provider}
              className="flex min-w-0 items-center justify-center gap-1.5 text-ui-sm text-foreground"
            >
              <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
              <span className="truncate">{PROVIDER_DISPLAY_NAMES[provider]}</span>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: PROVIDER_CHART_COLORS[provider] }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BucketColumn({
  bucket,
  scaleMax,
  granularity,
}: {
  readonly bucket: ProfileTokenBucket;
  readonly scaleMax: number;
  readonly granularity: Granularity;
}) {
  // The whole column is the hover target, but the tooltip sits on the bar itself.
  const barRef = useRef<HTMLDivElement>(null);
  const column = (
    <div className="flex h-full min-w-0 flex-1 flex-col justify-end hover:opacity-80">
      <div
        ref={barRef}
        className="flex flex-col-reverse"
        style={{ height: `${(bucket.total / scaleMax) * 100}%` }}
      >
        {bucket.byProvider.map((entry) => (
          <div
            key={entry.provider}
            className="min-h-0.5"
            style={{
              height: `${(entry.tokens / bucket.total) * 100}%`,
              background: PROVIDER_CHART_COLORS[entry.provider],
              ...ditherMask(BAR_DENSITY, { fadeTo: "top" }),
            }}
          />
        ))}
      </div>
    </div>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={column} />
      <TooltipPopup side="top" sideOffset={6} anchor={bucket.total > 0 ? barRef : undefined}>
        <TokenTooltipContent
          title={formatPeriodLabel(bucket.start, bucket.end, granularity)}
          total={bucket.total}
          unit="tokens"
          providers={bucket.byProvider}
        />
      </TooltipPopup>
    </Tooltip>
  );
}

// Rounds the axis maximum up to 1, 2, 2.5 or 5 times a power of ten so tick labels stay short.
function niceCeiling(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}
