import {
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
  formatRateLimitResetCountdown,
  type ProviderRateLimit,
  type VisibleRateLimitRow,
} from "~/lib/rateLimits";

type ProviderUsageTone = "healthy" | "warning" | "danger";

export interface ProviderUsageDisplayRow extends VisibleRateLimitRow {
  remainingLabel: string;
  leftText: string;
  resetText: string | null;
  remainingTone: ProviderUsageTone;
}

export interface ProviderUsageProgressTrackProps {
  label: string;
  remainingPercent: number;
  fillClassName: string;
}

const PROVIDER_USAGE_TONE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function remainingTone(remainingPercent: number): ProviderUsageTone {
  if (remainingPercent <= 10) return "danger";
  if (remainingPercent <= 25) return "warning";
  return "healthy";
}

function providerUsageToneClassName(tone: ProviderUsageTone): string {
  return PROVIDER_USAGE_TONE_CLASS_NAME[tone];
}

export function providerUsageProgressTrackProps(
  row: ProviderUsageDisplayRow,
): ProviderUsageProgressTrackProps {
  return {
    label: `${row.label} remaining`,
    remainingPercent: row.remainingPercent,
    fillClassName: providerUsageToneClassName(row.remainingTone),
  };
}

function deriveProviderUsageDisplayRow(row: VisibleRateLimitRow): ProviderUsageDisplayRow {
  const remainingPercent = clampPercent(row.remainingPercent);
  const remainingLabel = formatRateLimitRemainingPercent(remainingPercent);
  const usageRemainingTone = remainingTone(remainingPercent);

  return {
    ...row,
    remainingPercent,
    remainingLabel,
    leftText: `${remainingLabel} left`,
    resetText: row.resetsAt ? formatRateLimitResetCountdown(row.resetsAt) : null,
    remainingTone: usageRemainingTone,
  };
}

export function deriveProviderUsageDisplayRows(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
): ProviderUsageDisplayRow[] {
  return deriveVisibleRateLimitRows(rateLimits).map(deriveProviderUsageDisplayRow);
}

export function selectPrimaryProviderUsageDisplayRow(
  rows: ReadonlyArray<ProviderUsageDisplayRow>,
): ProviderUsageDisplayRow | null {
  return rows.reduce<ProviderUsageDisplayRow | null>((selected, row) => {
    if (!selected || row.remainingPercent < selected.remainingPercent) {
      return row;
    }
    return selected;
  }, null);
}
