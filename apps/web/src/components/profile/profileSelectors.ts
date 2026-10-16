import type {
  ProfileDayCount,
  ProfileHeatmapCell,
  ProfileModelDayTokens,
  ProfileStats,
  ProfileTokenStats,
} from "@glade/contracts/server/stats";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProfileRange } from "./useProfileRange";

export interface ProfileHeatmapSelection {
  readonly cells: ReadonlyArray<ProfileHeatmapCell>;

  readonly unit: "tokens" | "prompts";
}

export interface ProviderTokens {
  readonly provider: ProviderKind;
  readonly tokens: number;
}

export interface ProfileTokenBucket {
  readonly start: string;
  readonly end: string;
  readonly total: number;
  readonly byProvider: ReadonlyArray<ProviderTokens>;
}

export interface ProfileModelShare {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly tokens: number;
  readonly percent: number;
}

export interface ProfileRangeSummary {
  readonly tokens: number | null;
  readonly peakDayTokens: number | null;
  readonly agentSeconds: number;
  readonly chats: number;
  readonly granularity: "day" | "week" | "month";
  readonly buckets: ReadonlyArray<ProfileTokenBucket>;
  readonly providers: ReadonlyArray<ProviderKind>;
  readonly models: ReadonlyArray<ProfileModelShare>;
}

const MONTH_DAYS = 30;
const MAX_DAILY_BUCKETS = 62;
const MAX_WEEKLY_BUCKETS = 26;

export function selectProfileHeatmap(
  stats: ProfileStats,
  tokenStats: ProfileTokenStats | null,
): ProfileHeatmapSelection {
  if (tokenStats?.available) {
    return { cells: tokenStats.heatmap, unit: "tokens" };
  }
  return { cells: stats.activity.heatmap, unit: "prompts" };
}

export function selectProfileTopProvider(
  tokenStats: ProfileTokenStats | null,
): { readonly provider: ProviderKind; readonly percent: number | null } | null {
  if (!tokenStats?.available || !tokenStats.topProvider) {
    return null;
  }
  return { provider: tokenStats.topProvider, percent: tokenStats.topProviderPercent };
}

export function selectProfileDayProviders(
  tokenStats: ProfileTokenStats | null,
  day: string,
): ReadonlyArray<ProviderTokens> {
  return tokenStats?.available
    ? sumProviders(tokenStats.modelDays.filter((entry) => entry.day === day))
    : [];
}

// Monthly is the trailing 30 days. All time starts at the first day with any recorded activity.
export function selectProfileRangeSummary(
  stats: ProfileStats,
  tokenStats: ProfileTokenStats | null,
  range: ProfileRange,
): ProfileRangeSummary {
  const today = stats.timezone.today;
  const modelDays = tokenStats?.available ? tokenStats.modelDays : null;
  const start =
    range === "month"
      ? addDays(today, -(MONTH_DAYS - 1))
      : firstActiveDay(stats, modelDays ?? [], today);
  const inRange = (entry: { readonly day: string }) => entry.day >= start && entry.day <= today;
  const rangeModelDays = (modelDays ?? []).filter(inRange);

  const dailyTotals = new Map<string, number>();
  for (const entry of rangeModelDays) {
    dailyTotals.set(entry.day, (dailyTotals.get(entry.day) ?? 0) + entry.tokens);
  }
  const tokens = rangeModelDays.reduce((sum, entry) => sum + entry.tokens, 0);
  const providers = sumProviders(rangeModelDays).map((entry) => entry.provider);

  const dayCount = daysBetween(start, today) + 1;
  const granularity =
    dayCount <= MAX_DAILY_BUCKETS ? "day" : dayCount / 7 <= MAX_WEEKLY_BUCKETS ? "week" : "month";

  return {
    tokens: modelDays ? tokens : null,
    peakDayTokens: modelDays ? Math.max(0, ...dailyTotals.values()) : null,
    agentSeconds: sumCounts(stats.activity.agentDays.filter(inRange)),
    chats: sumCounts(stats.activity.threadDays.filter(inRange)),
    granularity,
    buckets: bucketTokens(rangeModelDays, start, today, granularity, providers),
    providers,
    models: modelShares(rangeModelDays, tokens),
  };
}

function bucketTokens(
  modelDays: ReadonlyArray<ProfileModelDayTokens>,
  start: string,
  today: string,
  granularity: ProfileRangeSummary["granularity"],
  providers: ReadonlyArray<ProviderKind>,
): ReadonlyArray<ProfileTokenBucket> {
  const bucketStart = (day: string) =>
    granularity === "day"
      ? day
      : granularity === "week"
        ? addDays(day, -weekdayIndex(day))
        : `${day.slice(0, 7)}-01`;
  const starts: string[] = [];
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const key = bucketStart(day);
    if (starts.at(-1) !== key) {
      starts.push(key);
    }
  }
  return starts.map((key, index) => {
    const next = starts[index + 1];
    const entries = modelDays.filter(
      (entry) => entry.day >= key && (next === undefined || entry.day < next),
    );
    const byProvider = sumProviders(entries).toSorted(
      (left, right) => providers.indexOf(left.provider) - providers.indexOf(right.provider),
    );
    return {
      start: key < start ? start : key,
      end: next === undefined ? today : addDays(next, -1),
      total: byProvider.reduce((sum, entry) => sum + entry.tokens, 0),
      byProvider,
    };
  });
}

function modelShares(
  modelDays: ReadonlyArray<ProfileModelDayTokens>,
  total: number,
): ReadonlyArray<ProfileModelShare> {
  const byModel = new Map<string, { provider: ProviderKind; model: string; tokens: number }>();
  for (const entry of modelDays) {
    if (entry.model === null) continue;
    const key = `${entry.provider}\u0000${entry.model}`;
    const existing = byModel.get(key);
    if (existing) {
      existing.tokens += entry.tokens;
    } else {
      byModel.set(key, { provider: entry.provider, model: entry.model, tokens: entry.tokens });
    }
  }
  return [...byModel.values()]
    .map((entry) => ({ ...entry, percent: total > 0 ? (entry.tokens / total) * 100 : 0 }))
    .toSorted((left, right) => right.tokens - left.tokens);
}

// Providers ordered by tokens, largest first.
function sumProviders(
  entries: ReadonlyArray<{ readonly provider: ProviderKind; readonly tokens: number }>,
): ReadonlyArray<ProviderTokens> {
  const totals = new Map<ProviderKind, number>();
  for (const entry of entries) {
    totals.set(entry.provider, (totals.get(entry.provider) ?? 0) + entry.tokens);
  }
  return [...totals.entries()]
    .filter(([, tokens]) => tokens > 0)
    .map(([provider, tokens]) => ({ provider, tokens }))
    .toSorted((left, right) => right.tokens - left.tokens);
}

function firstActiveDay(
  stats: ProfileStats,
  modelDays: ReadonlyArray<ProfileModelDayTokens>,
  today: string,
): string {
  const days = [
    ...stats.activity.heatmap.filter((cell) => cell.count > 0).map((cell) => cell.day),
    ...stats.activity.threadDays.map((entry) => entry.day),
    ...stats.activity.agentDays.map((entry) => entry.day),
    ...modelDays.map((entry) => entry.day),
  ];
  return days.reduce((first, day) => (day < first ? day : first), today);
}

function sumCounts(entries: ReadonlyArray<ProfileDayCount>): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

const DAY_MS = 86_400_000;

function parseDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function addDays(day: string, days: number): string {
  return new Date(parseDay(day) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((parseDay(end) - parseDay(start)) / DAY_MS);
}

// Weeks start on Monday.
function weekdayIndex(day: string): number {
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}
