import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { asPositiveFiniteNumber } from "@glade/shared/transport/payloadValues";
import { asString } from "@glade/shared/text/text";
import { ActivityPayload, toActivityPayload } from "./activityPayloads";

export function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
): ActivityPayload | undefined {
  if (event.type !== "thread.token-usage.updated") {
    return undefined;
  }
  const usage = event.payload.usage;
  const hasTokenUsage = usage.usedTokens > 0;
  const hasPercentUsage =
    typeof usage.usedPercent === "number" && Number.isFinite(usage.usedPercent);
  const hasKnownWindow = typeof usage.maxTokens === "number" && Number.isFinite(usage.maxTokens);
  const hasProcessedTokens =
    typeof usage.totalProcessedTokens === "number" &&
    Number.isFinite(usage.totalProcessedTokens) &&
    usage.totalProcessedTokens > 0;
  if (!hasTokenUsage && !hasPercentUsage && !hasKnownWindow && !hasProcessedTokens) {
    return undefined;
  }

  return toActivityPayload({
    ...usage,
    provider: event.provider,
    ...(event.providerRefs?.providerThreadId
      ? {
          usageSessionId: `${event.providerRefs.providerThreadId}${event.lifecycleGeneration ? `:${event.lifecycleGeneration}` : ""}`,
        }
      : {}),
  });
}

interface CompactModelUsage {
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export function compactTurnModelUsage(
  modelUsage: Record<string, unknown> | undefined,
): Record<string, CompactModelUsage> | undefined {
  if (!modelUsage) {
    return undefined;
  }
  const compact: Record<string, CompactModelUsage> = {};
  for (const [model, value] of Object.entries(modelUsage)) {
    const usage = asRecord(value) ?? undefined;
    if (!usage) {
      continue;
    }
    const inputTokens =
      (asPositiveFiniteNumber(usage.inputTokens) ?? 0) +
      (asPositiveFiniteNumber(usage.cacheReadInputTokens) ?? 0) +
      (asPositiveFiniteNumber(usage.cacheCreationInputTokens) ?? 0);
    const outputTokens = asPositiveFiniteNumber(usage.outputTokens) ?? 0;
    const totalTokens = inputTokens + outputTokens;
    if (totalTokens <= 0) {
      continue;
    }

    const cacheReadInputTokens = usage.cacheReadInputTokens;
    const cacheCreationInputTokens = usage.cacheCreationInputTokens;
    compact[model] = {
      inputTokens,
      outputTokens,
      totalTokens,
      ...(typeof cacheReadInputTokens === "number" &&
      Number.isFinite(cacheReadInputTokens) &&
      cacheReadInputTokens >= 0
        ? { cacheReadInputTokens }
        : {}),
      ...(typeof cacheCreationInputTokens === "number" &&
      Number.isFinite(cacheCreationInputTokens) &&
      cacheCreationInputTokens >= 0
        ? { cacheCreationInputTokens }
        : {}),
    };
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function buildConfiguredContextWindowPayload(
  event: ProviderRuntimeEvent,
): ActivityPayload | undefined {
  if (event.type !== "session.configured") {
    return undefined;
  }
  const config = asRecord(event.payload.config) ?? undefined;
  const autoCompactWindow = config?.autoCompactWindow;
  const legacyContextWindow = config?.contextWindow;
  const configuredWindowValue = autoCompactWindow ?? legacyContextWindow;
  const configuredWindow = asString(configuredWindowValue)?.trim().toLowerCase();
  const maxTokens =
    asPositiveFiniteNumber(configuredWindowValue) ??
    (configuredWindow === "1m" ? 1_000_000 : configuredWindow === "200k" ? 200_000 : undefined);
  if (maxTokens === undefined) {
    const explicitlyCleared =
      (autoCompactWindow === null &&
        (legacyContextWindow === undefined || legacyContextWindow === null)) ||
      (autoCompactWindow === undefined && legacyContextWindow === null);
    return explicitlyCleared ? toActivityPayload({ cleared: true }) : undefined;
  }
  return toActivityPayload({
    maxTokens,
    ...(configuredWindow ? { contextWindow: configuredWindow } : {}),
  });
}
