import type {
  ProfileHeatmapCell,
  ProfileStats,
  ProfileTokenStats,
  ProviderKind,
} from "@glade/contracts";

export interface ProfileHeatmapSelection {
  readonly cells: ReadonlyArray<ProfileHeatmapCell>;

  readonly unit: "tokens" | "prompts";
}

export interface ProfileTopProviderSelection {
  readonly provider: ProviderKind | null;
  readonly percent: number | null;
  readonly metric: "tokens" | "turns";

  readonly unavailableProviders: ReadonlyArray<ProviderKind>;
}

interface ProfileModelUsageEntry {
  readonly provider: ProviderKind | "unknown";
  readonly model: string;
  readonly percent: number;
}

export interface ProfileModelUsageSelection {
  readonly entries: ReadonlyArray<ProfileModelUsageEntry>;
  readonly metric: "tokens" | "turns";

  readonly unavailableProviders: ReadonlyArray<ProviderKind>;
}

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
  stats: ProfileStats,
  tokenStats: ProfileTokenStats | null,
): ProfileTopProviderSelection {
  if (tokenStats?.available && tokenStats.topProvider) {
    return {
      provider: tokenStats.topProvider,
      percent: tokenStats.topProviderPercent,
      metric: "tokens",
      unavailableProviders: tokenStats.unavailableProviders,
    };
  }

  return {
    provider: stats.insights.topProvider,
    percent: stats.insights.topProviderPercent,
    metric: "turns",
    unavailableProviders: [],
  };
}

export function selectProfileModelUsage(
  stats: ProfileStats,
  tokenStats: ProfileTokenStats | null,
): ProfileModelUsageSelection {
  if (tokenStats?.available && tokenStats.models.length > 0) {
    return {
      entries: tokenStats.models,
      metric: "tokens",
      unavailableProviders: tokenStats.unavailableProviders,
    };
  }
  return { entries: stats.providerModels, metric: "turns", unavailableProviders: [] };
}
