import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "../core/baseSchemas";
import { ProviderKind } from "../core/baseSchemas";

export const StatsGetProfileStatsInput = Schema.Struct({
  utcOffsetMinutes: Schema.Int,
});
export type StatsGetProfileStatsInput = typeof StatsGetProfileStatsInput.Type;

export const StatsGetProfileTokenStatsInput = StatsGetProfileStatsInput;
export type StatsGetProfileTokenStatsInput = typeof StatsGetProfileTokenStatsInput.Type;

export const ProfileHeatmapCell = Schema.Struct({
  day: TrimmedNonEmptyString,
  count: NonNegativeInt,
  weekday: Schema.Int,
  intensity: NonNegativeInt,
});
export type ProfileHeatmapCell = typeof ProfileHeatmapCell.Type;

export const ProfileModelDayTokens = Schema.Struct({
  day: TrimmedNonEmptyString,
  provider: ProviderKind,
  // Null when the provider reported tokens without naming the model.
  model: Schema.NullOr(TrimmedNonEmptyString),
  tokens: NonNegativeInt,
});
export type ProfileModelDayTokens = typeof ProfileModelDayTokens.Type;

export const ProfileDayCount = Schema.Struct({
  day: TrimmedNonEmptyString,
  count: NonNegativeInt,
});
export type ProfileDayCount = typeof ProfileDayCount.Type;

export const ProfileActivity = Schema.Struct({
  currentStreakDays: NonNegativeInt,
  longestStreakDays: NonNegativeInt,
  // Chats started per local day.
  threadDays: Schema.Array(ProfileDayCount),
  // Seconds agents spent working on top-level chats per local day, with idle gaps inside a turn
  // capped.
  agentDays: Schema.Array(ProfileDayCount),

  heatmapMetric: Schema.Literal("prompts"),
  heatmap: Schema.Array(ProfileHeatmapCell),
});
export type ProfileActivity = typeof ProfileActivity.Type;

export const ProfileIdentity = Schema.Struct({
  homeDirBasename: Schema.String,
  defaultHandle: Schema.String,
});
export type ProfileIdentity = typeof ProfileIdentity.Type;

export const ProfileTimezone = Schema.Struct({
  utcOffsetMinutes: Schema.Int,
  today: TrimmedNonEmptyString,
});
export type ProfileTimezone = typeof ProfileTimezone.Type;

export const ProfileStats = Schema.Struct({
  generatedAt: IsoDateTime,
  timezone: ProfileTimezone,
  identity: ProfileIdentity,
  activity: ProfileActivity,
});
export type ProfileStats = typeof ProfileStats.Type;

export const StatsGetProfileStatsResult = ProfileStats;
export type StatsGetProfileStatsResult = typeof StatsGetProfileStatsResult.Type;

export const ProfileTokenStats = Schema.Struct({
  available: Schema.Boolean,
  lifetimeTotalTokens: Schema.NullOr(NonNegativeInt),
  peakDayTokens: Schema.NullOr(NonNegativeInt),
  peakDay: Schema.NullOr(TrimmedNonEmptyString),
  providers: Schema.Array(ProviderKind),

  unavailableProviders: Schema.Array(ProviderKind),

  topProvider: Schema.NullOr(ProviderKind),
  topProviderPercent: Schema.NullOr(Schema.Number),

  modelDays: Schema.Array(ProfileModelDayTokens),
  heatmapMetric: Schema.Literal("tokens"),
  heatmap: Schema.Array(ProfileHeatmapCell),
});
export type ProfileTokenStats = typeof ProfileTokenStats.Type;

export const StatsGetProfileTokenStatsResult = ProfileTokenStats;
export type StatsGetProfileTokenStatsResult = typeof StatsGetProfileTokenStatsResult.Type;
