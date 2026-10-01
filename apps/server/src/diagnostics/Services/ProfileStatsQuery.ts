import type {
  StatsGetProfileStatsInput,
  ProfileStats,
  StatsGetProfileTokenStatsInput,
  ProfileTokenStats,
} from "@glade/contracts/server/stats";
import { Effect, ServiceMap } from "effect";
import type { TaggedFailure } from "../../platform/operationError.ts";

export interface ProfileStatsQueryShape {
  readonly getProfileStats: (
    input: StatsGetProfileStatsInput,
  ) => Effect.Effect<ProfileStats, TaggedFailure>;
  readonly getProfileTokenStats: (
    input: StatsGetProfileTokenStatsInput,
  ) => Effect.Effect<ProfileTokenStats, TaggedFailure>;
}

export class ProfileStatsQuery extends ServiceMap.Service<
  ProfileStatsQuery,
  ProfileStatsQueryShape
>()("glade/profileStats/ProfileStatsQuery") {}
