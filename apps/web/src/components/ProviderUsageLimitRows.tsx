import {
  providerUsageProgressTrackProps,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";

import { UsageProgressTrack } from "./UsageProgressTrack";

function ProviderUsageLimitRow({ row }: { row: ProviderUsageDisplayRow }) {
  return (
    <div className="space-y-1 text-chat-meta leading-tight">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-ui-sm font-medium text-foreground">{row.label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-foreground">
          {row.leftText}
        </span>
      </div>
      <UsageProgressTrack {...providerUsageProgressTrackProps(row)} className="h-1.5 bg-muted/80" />
      {row.resetText ? (
        <div className="text-right tabular-nums text-muted-foreground">{row.resetText}</div>
      ) : null}
    </div>
  );
}

export function ProviderUsageLimitRows({ rows }: { rows: ReadonlyArray<ProviderUsageDisplayRow> }) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ProviderUsageLimitRow key={row.id} row={row} />
      ))}
    </div>
  );
}
