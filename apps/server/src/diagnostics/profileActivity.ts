import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProfileStats } from "@glade/contracts/server/stats";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { TokenDayRow, num, MostWorkedProjectRow } from "./profileQueryValues";

const HEATMAP_WINDOW_DAYS = 274;

const PROVIDER_KINDS = new Set<ProviderKind>(["codex", "claudeAgent"]);

type HeatmapCell = ProfileStats["activity"]["heatmap"][number];

type MostWorkedProject = ProfileStats["mostWorkedProject"];

export function localToday(utcOffsetMinutes: number): string {
  return new Date(Date.now() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function addDaysIso(day: string, delta: number): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + delta * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

const HEATMAP_LEVELS = 4;

function heatmapIntensity(count: number, sortedActiveCounts: readonly number[]): number {
  if (count <= 0 || sortedActiveCounts.length === 0) {
    return 0;
  }

  let low = 0;
  let high = sortedActiveCounts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedActiveCounts[mid]! <= count) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const level = Math.ceil((low * HEATMAP_LEVELS) / sortedActiveCounts.length);
  return Math.min(HEATMAP_LEVELS, Math.max(1, level));
}

export function percent1(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

export function compareNullableText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

export function deriveInitials(name: string): string {
  const parts = name.split(/[\s._-]+/u).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "SY";
  }
  const single = parts[0] ?? name;
  return (single.slice(0, 2) || "SY").toUpperCase();
}

export function sanitizeHandle(basename: string): string {
  const slug = basename.toLowerCase().replace(/[^a-z0-9_]/gu, "");
  return `@${slug || "glade"}`;
}

export function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

export function arcName(startHour: number): string {
  if (startHour < 5) return "Late-Night Dev Arc";
  if (startHour < 9) return "Early Bird Arc";
  if (startHour < 12) return "Morning Arc";
  if (startHour < 17) return "Afternoon Arc";
  if (startHour < 21) return "Evening Arc";
  return "Night Owl Arc";
}

export function normalizeProviderKind(value: unknown): ProviderKind | "unknown" {
  const provider = nonEmptyTrimmed(value) ?? null;
  return provider && PROVIDER_KINDS.has(provider as ProviderKind)
    ? (provider as ProviderKind)
    : "unknown";
}

interface TokenModelUsageCount {
  readonly provider: ProviderKind | "unknown";
  readonly model: string;
  tokens: number;
}

interface TokenActivityAggregate {
  readonly tokensByDay: Map<string, number>;
  readonly tokensByProvider: Map<ProviderKind, number>;
  readonly tokensByProviderModel: Map<string, TokenModelUsageCount>;
  readonly lifetime: number;
}

export function aggregateTokenActivity(rows: ReadonlyArray<TokenDayRow>): TokenActivityAggregate {
  const tokensByDay = new Map<string, number>();
  const tokensByProvider = new Map<ProviderKind, number>();
  const tokensByProviderModel = new Map<string, TokenModelUsageCount>();
  let lifetime = 0;
  for (const row of rows) {
    const day = nonEmptyTrimmed(row.day) ?? null;
    const tokens = num(row.tokens);
    if (!day || tokens <= 0) {
      continue;
    }
    tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + tokens);
    lifetime += tokens;
    const provider = normalizeProviderKind(row.provider);
    if (provider !== "unknown") {
      tokensByProvider.set(provider, (tokensByProvider.get(provider) ?? 0) + tokens);
    }
    const model = nonEmptyTrimmed(row.model) ?? "unknown";
    const providerModelKey = `${provider}\u0000${model}`;
    const existing = tokensByProviderModel.get(providerModelKey);
    if (existing) {
      existing.tokens += tokens;
    } else {
      tokensByProviderModel.set(providerModelKey, { provider, model, tokens });
    }
  }
  return { tokensByDay, tokensByProvider, tokensByProviderModel, lifetime };
}

export function computeStreaks(
  activeDaysAsc: ReadonlyArray<string>,
  todayKey: string,
): { current: number; longest: number } {
  if (activeDaysAsc.length === 0) {
    return { current: 0, longest: 0 };
  }
  const set = new Set(activeDaysAsc);

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of activeDaysAsc) {
    run = previous && addDaysIso(previous, 1) === day ? run + 1 : 1;
    if (run > longest) {
      longest = run;
    }
    previous = day;
  }

  let anchor: string | null = set.has(todayKey)
    ? todayKey
    : set.has(addDaysIso(todayKey, -1))
      ? addDaysIso(todayKey, -1)
      : null;
  let current = 0;
  while (anchor && set.has(anchor)) {
    current += 1;
    anchor = addDaysIso(anchor, -1);
  }

  return { current, longest };
}

export function buildHeatmap(
  countByDay: ReadonlyMap<string, number>,
  todayKey: string,
): HeatmapCell[] {
  const windowStart = addDaysIso(todayKey, -(HEATMAP_WINDOW_DAYS - 1));

  const activeCounts: number[] = [];
  for (const [day, count] of countByDay) {
    if (day >= windowStart && day <= todayKey && count > 0) {
      activeCounts.push(count);
    }
  }
  activeCounts.sort((left, right) => left - right);

  const heatmap: HeatmapCell[] = [];
  for (let offset = 0; offset < HEATMAP_WINDOW_DAYS; offset += 1) {
    const day = addDaysIso(windowStart, offset);
    const count = countByDay.get(day) ?? 0;
    heatmap.push({
      day,
      count,
      weekday: weekdayOf(day),
      intensity: heatmapIntensity(count, activeCounts),
    });
  }
  return heatmap;
}

export function buildMostWorkedProject(row: MostWorkedProjectRow | undefined): MostWorkedProject {
  if (!row) {
    return null;
  }

  const projectId = nonEmptyTrimmed(row.projectId) ?? null;
  const title = nonEmptyTrimmed(row.title) ?? null;
  const workspaceRoot = nonEmptyTrimmed(row.workspaceRoot) ?? null;
  const lastWorkedAt = nonEmptyTrimmed(row.lastWorkedAt) ?? null;
  if (!projectId || !title || !workspaceRoot || !lastWorkedAt) {
    return null;
  }

  return {
    projectId,
    title,
    workspaceRoot,
    promptCount: num(row.promptCount),
    threadCount: num(row.threadCount),
    activeDays: num(row.activeDays),
    lastWorkedAt,
  };
}
