import {
  providerUsageProgressTrackProps,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";

import { UsageProgressTrack } from "./UsageProgressTrack";

export type ProviderUsageLimitRowsSurface = "settings" | "popover";

function ProviderUsageTrack({
  row,
  surface,
}: {
  row: ProviderUsageDisplayRow;
  surface: ProviderUsageLimitRowsSurface;
}) {
  const trackProps = providerUsageProgressTrackProps(row);

  return (
    <UsageProgressTrack
      {...trackProps}
      className={surface === "popover" ? "h-1.5 bg-muted/80" : undefined}
    />
  );
}

function SettingsUsageLimitRow({ row }: { row: ProviderUsageDisplayRow }) {
  return (
    <div className="space-y-1.5">
      <div className="text-ui leading-snug font-medium text-foreground">{row.label}</div>
      <ProviderUsageTrack row={row} surface="settings" />
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-ui-sm tabular-nums text-muted-foreground">
        <span className="shrink-0 whitespace-nowrap">{row.leftText}</span>
        {row.resetText ? <span>{row.resetText}</span> : null}
      </div>
    </div>
  );
}

function PopoverUsageLimitRow({ row }: { row: ProviderUsageDisplayRow }) {
  return (
    <div className="space-y-1 text-chat-meta leading-tight">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-ui-sm font-medium text-foreground">{row.label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-foreground">
          {row.leftText}
        </span>
      </div>
      <ProviderUsageTrack row={row} surface="popover" />
      {row.resetText ? (
        <div className="text-right tabular-nums text-muted-foreground">{row.resetText}</div>
      ) : null}
    </div>
  );
}

export function ProviderUsageLimitRows({
  rows,
  surface,
}: {
  rows: ReadonlyArray<ProviderUsageDisplayRow>;
  surface: ProviderUsageLimitRowsSurface;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((row) =>
        surface === "settings" ? (
          <SettingsUsageLimitRow key={row.id} row={row} />
        ) : (
          <PopoverUsageLimitRow key={row.id} row={row} />
        ),
      )}
    </div>
  );
}
