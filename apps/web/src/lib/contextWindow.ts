import { asFiniteNumber } from "@glade/shared/transport/payloadValues";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { type ThreadTokenUsageSnapshot } from "@glade/contracts/provider/runtimePayloads";

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asContextWindowPercent(value: unknown): number | null {
  const percent = asFiniteNumber(value) ?? null;
  if (percent === null) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export interface ContextWindowState {
  readonly snapshot: ContextWindowSnapshot | null;
  readonly invalidatedByCompaction: boolean;
}

export interface ContextWindowMeterDisplay {
  readonly usedPercentageLabel: string | null;
  readonly tokenUsageLabel: string;
  readonly hasReliableTokenRatio: boolean;
  readonly normalizedPercentage: number;
  readonly compactLabel: string;
  readonly ariaLabel: string;
}

function isCompletedContextCompaction(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "context-compaction") {
    return false;
  }
  const payload = asObjectRecord(activity.payload);
  return payload?.state === "compacted" || payload?.status === "completed";
}

export function deriveLatestContextWindowState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowState {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity) {
      continue;
    }

    if (activity.kind === "context-window.configured") {
      return { snapshot: null, invalidatedByCompaction: false };
    }
    if (isCompletedContextCompaction(activity)) {
      return { snapshot: null, invalidatedByCompaction: true };
    }
    if (activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asObjectRecord(activity.payload);
    const rawUsedTokens = asFiniteNumber(payload?.usedTokens) ?? null;
    const usedTokens = rawUsedTokens ?? 0;
    const payloadUsedPercent = asContextWindowPercent(payload?.usedPercent);
    const maxTokens = asFiniteNumber(payload?.maxTokens) ?? null;
    if (usedTokens <= 0 && payloadUsedPercent === null && (maxTokens === null || maxTokens <= 0)) {
      continue;
    }

    const usedPercentage =
      payloadUsedPercent ??
      (maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null);
    const hasReliableTokenUsage =
      rawUsedTokens !== null &&
      (usedTokens > 0 || payloadUsedPercent === null || (maxTokens !== null && maxTokens > 0));
    const remainingTokens =
      maxTokens !== null && hasReliableTokenUsage
        ? Math.max(0, Math.round(maxTokens - usedTokens))
        : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      snapshot: {
        usedTokens,
        usedPercent: payloadUsedPercent,

        totalProcessedTokens:
          payload?.provider === "claudeAgent" && payload.tokenAccountingVersion !== 1
            ? null
            : (asFiniteNumber(payload?.totalProcessedTokens) ?? null),
        tokenAccountingVersion: payload?.tokenAccountingVersion === 1 ? 1 : null,
        maxTokens,
        remainingTokens,
        usedPercentage,
        remainingPercentage,
        inputTokens: asFiniteNumber(payload?.inputTokens) ?? null,
        cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens) ?? null,
        outputTokens: asFiniteNumber(payload?.outputTokens) ?? null,
        reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens) ?? null,
        lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens) ?? null,
        lastInputTokens: asFiniteNumber(payload?.lastInputTokens) ?? null,
        lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens) ?? null,
        lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens) ?? null,
        lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens) ?? null,
        toolUses: asFiniteNumber(payload?.toolUses) ?? null,
        durationMs: asFiniteNumber(payload?.durationMs) ?? null,
        compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
        updatedAt: activity.createdAt,
      },
      invalidatedByCompaction: false,
    };
  }

  return { snapshot: null, invalidatedByCompaction: false };
}

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function deriveContextWindowMeterDisplay(
  usage: ContextWindowSnapshot,
): ContextWindowMeterDisplay {
  const usedPercentageLabel = formatPercentage(usage.usedPercentage);
  const tokenUsageLabel = formatContextWindowTokens(usage.usedTokens);
  const hasReliableTokenRatio =
    usage.maxTokens !== null &&
    (usage.usedTokens > 0 || usage.usedPercent === null || usage.remainingTokens !== null);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  return {
    usedPercentageLabel,
    tokenUsageLabel,
    hasReliableTokenRatio,
    normalizedPercentage,
    compactLabel:
      usage.usedPercentage !== null ? `${Math.round(usage.usedPercentage)}%` : tokenUsageLabel,
    ariaLabel: usedPercentageLabel
      ? `Context window ${usedPercentageLabel} used`
      : `Context window ${tokenUsageLabel} tokens used`,
  };
}

export function deriveCumulativeCostUsd(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): number | null {
  let turnDeltaTotal = 0;
  let latestCumulative: number | null = null;
  let foundTurnDelta = false;
  for (const activity of activities) {
    if (activity.kind !== "turn.completed") continue;
    const payload = asObjectRecord(activity.payload);
    const cumulativeCost = asFiniteNumber(payload?.cumulativeCostUsd) ?? null;
    if (cumulativeCost !== null) {
      latestCumulative = cumulativeCost;
      continue;
    }
    const cost = asFiniteNumber(payload?.totalCostUsd) ?? null;
    if (cost === null) continue;
    turnDeltaTotal += cost;
    foundTurnDelta = true;
  }
  if (latestCumulative !== null) {
    return latestCumulative + turnDeltaTotal;
  }
  return foundTurnDelta ? turnDeltaTotal : null;
}

export function formatCostUsd(value: number): string {
  if (value < 0.0001) return `$${value.toFixed(6)}`;
  if (value < 0.001) return `$${value.toFixed(5)}`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 0.1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatContextWindowTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
