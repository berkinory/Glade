import type { ProviderKind } from "@glade/contracts";

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${trimZero(value / 1_000_000_000)}bn`;
  }
  if (abs >= 1_000_000) {
    return `${trimZero(value / 1_000_000)}m`;
  }
  if (abs >= 1_000) {
    return `${trimZero(value / 1_000)}k`;
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

export function formatShortDate(day: string | null): string | null {
  if (!day) {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return null;
  }
  return MONTH_DAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, date)));
}

export function formatProviderLabel(provider: ProviderKind): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claudeAgent":
      return "Claude";
  }
}

export function formatProfileUsageBasis(metric: "tokens" | "turns"): string {
  return metric === "tokens" ? "tracked tokens" : "turns";
}

const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
