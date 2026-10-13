import type {
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { asNumericValue, asObjectRecord } from "@glade/shared/transport/payloadValues";
import { nonEmptyTrimmed } from "@glade/shared/text/text";

import { clampPercent, formatUsd, isoFromString } from "../parse";

const BILLING_CYCLE_MINS = 30 * 24 * 60;

interface CursorMappedUsage {
  readonly limits: ServerProviderUsageLimit[];
  readonly usageLines: ServerProviderUsageLine[];
}

function billingCycle(usage: Record<string, unknown>) {
  const startMs = asNumericValue(usage.billingCycleStart);
  const endMs = asNumericValue(usage.billingCycleEnd);
  const resetsAt = endMs !== undefined ? new Date(endMs).toISOString() : undefined;
  const windowDurationMins =
    startMs !== undefined && endMs !== undefined && endMs > startMs
      ? Math.round((endMs - startMs) / 60_000)
      : BILLING_CYCLE_MINS;
  return { ...(resetsAt ? { resetsAt } : {}), windowDurationMins };
}

// Usage-based extra spend, preferring the user's own figures over the team pool. Values are cents.
function onDemandLine(spendLimitUsage: Record<string, unknown> | null): ServerProviderUsageLine[] {
  if (!spendLimitUsage) return [];
  const limit =
    asNumericValue(spendLimitUsage.individualLimit) ??
    asNumericValue(spendLimitUsage.pooledLimit) ??
    0;
  const remaining =
    asNumericValue(spendLimitUsage.individualRemaining) ??
    asNumericValue(spendLimitUsage.pooledRemaining) ??
    0;
  const reported = [
    spendLimitUsage.individualUsed,
    spendLimitUsage.pooledUsed,
    spendLimitUsage.totalSpend,
  ].flatMap((value) => {
    const cents = asNumericValue(value);
    return cents === undefined ? [] : [cents];
  });
  const inferred = Math.max(0, limit - remaining);
  const spent =
    reported.find((cents) => cents > 0) ?? (inferred > 0 ? inferred : (reported[0] ?? 0));
  if (limit > 0) {
    return [
      { label: "On-demand", value: `${formatUsd(spent / 100)} of ${formatUsd(limit / 100)}` },
    ];
  }
  return spent > 0 ? [{ label: "On-demand", value: `${formatUsd(spent / 100)} spent` }] : [];
}

// Null when the account has no active subscription.
export function mapCursorPlanUsage(
  usage: Record<string, unknown>,
  planName: string | undefined,
): CursorMappedUsage | null {
  const planUsage = asObjectRecord(usage.planUsage);
  if (usage.enabled === false || !planUsage) return null;

  const limitCents = asNumericValue(planUsage.limit);
  const totalPercent = asNumericValue(planUsage.totalPercentUsed);
  const autoPercent = asNumericValue(planUsage.autoPercentUsed);
  const apiPercent = asNumericValue(planUsage.apiPercentUsed);
  const spentCents =
    asNumericValue(planUsage.totalSpend) ??
    (limitCents ?? 0) - (asNumericValue(planUsage.remaining) ?? limitCents ?? 0);
  // Older team payloads send zero pool placeholders beside real spend.
  const hasModelPools =
    autoPercent !== undefined &&
    apiPercent !== undefined &&
    autoPercent >= 0 &&
    apiPercent >= 0 &&
    (autoPercent > 0 || apiPercent > 0 || spentCents === 0);
  const spendLimitUsage = asObjectRecord(usage.spendLimitUsage);
  const isTeam =
    planName?.toLowerCase() === "team" ||
    nonEmptyTrimmed(spendLimitUsage?.limitType)?.toLowerCase() === "team" ||
    (asNumericValue(spendLimitUsage?.pooledLimit) ?? 0) > 0;
  // Team seats still report a stale dollar allowance next to their model pools; never total that.
  const computedPercent =
    limitCents !== undefined && limitCents > 0 ? (spentCents / limitCents) * 100 : undefined;
  const total = totalPercent ?? (isTeam && hasModelPools ? undefined : computedPercent);

  const cycle = billingCycle(usage);
  const limits = (
    [
      ["Total", "total", total],
      ["Cursor models", "auto", autoPercent],
      ["Other models", "api", apiPercent],
    ] as const
  ).flatMap(([window, limitId, percent]) => {
    const usedPercent = clampPercent(percent);
    return usedPercent === undefined ? [] : [{ window, limitId, usedPercent, ...cycle }];
  });
  return { limits, usageLines: onDemandLine(spendLimitUsage) };
}

export function mapCursorRequestUsage(json: unknown): CursorMappedUsage {
  const usage = asObjectRecord(json);
  const requests = asObjectRecord(usage?.["gpt-4"]);
  const maxRequests = asNumericValue(requests?.maxRequestUsage);
  if (maxRequests === undefined || maxRequests <= 0) return { limits: [], usageLines: [] };
  const used = asNumericValue(requests?.numRequests) ?? 0;
  const cycleStart = isoFromString(usage?.startOfMonth);
  const resetsAt = cycleStart
    ? new Date(Date.parse(cycleStart) + BILLING_CYCLE_MINS * 60_000).toISOString()
    : undefined;
  return {
    limits: [
      {
        window: "Requests",
        limitId: "requests",
        usedPercent: clampPercent((used / maxRequests) * 100) ?? 0,
        ...(resetsAt ? { resetsAt } : {}),
        windowDurationMins: BILLING_CYCLE_MINS,
      },
    ],
    usageLines: [{ label: "Requests", value: `${used} of ${maxRequests}` }],
  };
}
