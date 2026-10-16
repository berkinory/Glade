export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${trimZero(value / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${trimZero(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${trimZero(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return WHOLE_NUMBER_FORMATTER.format(value);
}

export function formatDays(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? "day" : "days"}`;
}

// Whole hours once there are any, so a lifetime total reads as "48h" rather than "48h 12m".
export function formatAgentDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 10 ? `${hours}h ${minutes % 60}m` : `${formatNumber(hours)}h`;
}

export function toDisplayName(basename: string): string {
  const cleaned = basename
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return "Glade";
  }
  return cleaned
    .split(" ")
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function normalizeHandle(value: string): string {
  const slug = value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
  return `@${slug || "glade"}`;
}

function formatShortDate(day: string | null): string | null {
  if (!day) {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return null;
  }
  return MONTH_DAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, date)));
}

// Tooltip title for a day, week or month of activity.
export function formatPeriodLabel(
  start: string,
  end: string,
  granularity: "day" | "week" | "month",
): string {
  if (granularity === "day") {
    return WEEKDAY_DATE_FORMATTER.format(utcDate(start));
  }
  if (granularity === "month") {
    return MONTH_YEAR_FORMATTER.format(utcDate(start));
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

export function formatAxisLabel(day: string, granularity: "day" | "week" | "month"): string {
  return granularity === "month"
    ? MONTH_FORMATTER.format(utcDate(day))
    : (formatShortDate(day) ?? day);
}

function utcDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
}

const WEEKDAY_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });
const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
