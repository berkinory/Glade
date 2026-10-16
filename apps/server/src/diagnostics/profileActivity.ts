import { Schema } from "effect";
import { normalizeModelSlug } from "@glade/shared/provider/model";
import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ProfileDayCount,
  ProfileStats,
  ProfileTokenStats,
} from "@glade/contracts/server/stats";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { DayCountRow, TokenDayRow, num } from "./profileQueryValues";

const HEATMAP_WINDOW_DAYS = 274;

type HeatmapCell = ProfileStats["activity"]["heatmap"][number];

type ModelDayTokens = ProfileTokenStats["modelDays"][number];

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

export function sanitizeHandle(basename: string): string {
  const slug = basename.toLowerCase().replace(/[^a-z0-9_]/gu, "");
  return `@${slug || "glade"}`;
}

export function normalizeProviderKind(value: unknown): ProviderKind | "unknown" {
  const provider = nonEmptyTrimmed(value) ?? null;
  return provider && Schema.is(ProviderKind)(provider) ? provider : "unknown";
}

function normalizeUsageModel(
  model: string | null | undefined,
  provider: ProviderKind | "unknown",
): string {
  return normalizeModelSlug(model, provider === "unknown" ? undefined : provider) ?? "unknown";
}

interface TokenActivityAggregate {
  readonly tokensByDay: Map<string, number>;
  readonly tokensByProvider: Map<ProviderKind, number>;
  // Unknown providers still count toward the day and lifetime totals.
  readonly modelDays: ModelDayTokens[];
  readonly lifetime: number;
}

export function aggregateTokenActivity(rows: ReadonlyArray<TokenDayRow>): TokenActivityAggregate {
  const tokensByDay = new Map<string, number>();
  const tokensByProvider = new Map<ProviderKind, number>();
  const tokensByModelDay = new Map<string, ModelDayTokens>();
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
    if (provider === "unknown") {
      continue;
    }
    tokensByProvider.set(provider, (tokensByProvider.get(provider) ?? 0) + tokens);
    const normalizedModel = normalizeUsageModel(row.model, provider);
    const model = normalizedModel === "unknown" ? null : normalizedModel;
    const key = `${day}\u0000${provider}\u0000${model ?? ""}`;
    const existing = tokensByModelDay.get(key);
    tokensByModelDay.set(key, { day, provider, model, tokens: (existing?.tokens ?? 0) + tokens });
  }
  const modelDays = [...tokensByModelDay.values()].toSorted(
    (left, right) =>
      left.day.localeCompare(right.day) ||
      left.provider.localeCompare(right.provider) ||
      (left.model ?? "").localeCompare(right.model ?? ""),
  );
  return { tokensByDay, tokensByProvider, modelDays, lifetime };
}

export function dayCounts(rows: ReadonlyArray<DayCountRow>): ProfileDayCount[] {
  return rows.flatMap((row) => {
    const day = nonEmptyTrimmed(row.day) ?? null;
    const count = num(row.count);
    return day && count > 0 ? [{ day, count }] : [];
  });
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
