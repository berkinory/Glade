import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderUsageSnapshot } from "@glade/contracts/server/server";

export interface ProviderUsageContext {
  readonly homeDir: string;

  readonly env: NodeJS.ProcessEnv;

  readonly platform: NodeJS.Platform;

  readonly nowMs: number;

  readonly claudeBinaryPath?: string;

  readonly codexBinaryPath?: string;

  readonly codexHomePath?: string;
}

export interface ProviderUsageFetcher {
  readonly provider: ProviderKind;
  // Null disables caching for the request when credential identity cannot be read safely.
  readonly cacheKey?: (ctx: ProviderUsageContext) => Promise<string | null>;

  fetch(ctx: ProviderUsageContext): Promise<ServerProviderUsageSnapshot>;
}
