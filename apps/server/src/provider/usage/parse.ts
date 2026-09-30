import { asNumericValue } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ProviderUsageStatus,
  ServerCodexResetCredits,
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
  ServerProviderUsageSnapshot,
} from "@glade/contracts/server/server";
import { providerUsageNeedsAuthDetail } from "@glade/shared/provider/providerUsage";

export function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, value));
}

export function isoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = asNumericValue(value);
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isoFromUnixMillis(value: unknown): string | undefined {
  const millis = asNumericValue(value);
  if (millis === undefined || millis <= 0) {
    return undefined;
  }
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isoFromString(value: unknown): string | undefined {
  const text = nonEmptyTrimmed(value);
  if (!text) {
    return undefined;
  }
  const millis = Date.parse(text);
  return Number.isNaN(millis) ? undefined : new Date(millis).toISOString();
}

export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface SnapshotInput {
  provider: ProviderKind;
  nowMs: number;
  status: ProviderUsageStatus;
  source: string;
  limits?: ReadonlyArray<ServerProviderUsageLimit>;
  usageLines?: ReadonlyArray<ServerProviderUsageLine>;
  planName?: string;
  detail?: string;
  resetCredits?: ServerCodexResetCredits;
}

export function buildSnapshot(input: SnapshotInput): ServerProviderUsageSnapshot {
  return {
    provider: input.provider,
    updatedAt: new Date(input.nowMs).toISOString(),
    limits: input.limits ?? [],
    usageLines: input.usageLines ?? [],
    source: input.source,
    status: input.status,
    ...(input.planName ? { planName: input.planName } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.resetCredits ? { resetCredits: input.resetCredits } : {}),
  };
}

export function needsAuthSnapshot(
  provider: ProviderKind,
  nowMs: number,
  source: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({
    provider,
    nowMs,
    status: "needs-auth",
    source,
    detail: providerUsageNeedsAuthDetail(provider),
  });
}

export function unsupportedSnapshot(
  provider: ProviderKind,
  nowMs: number,
  source: string,
  detail: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({ provider, nowMs, status: "unsupported", source, detail });
}

export function errorSnapshot(
  provider: ProviderKind,
  nowMs: number,
  source: string,
  detail: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({ provider, nowMs, status: "error", source, detail });
}
