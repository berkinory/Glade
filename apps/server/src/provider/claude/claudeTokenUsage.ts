import { asPositiveFiniteNumber } from "@glade/shared/transport/payloadValues";
import type {
  ModelUsage,
  NonNullableUsage,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import type { ThreadTokenUsageSnapshot } from "@glade/contracts/provider/runtimePayloads";
const CLAUDE_CONTEXT_WARNING_RATIO = 0.8;
const CLAUDE_UNCACHED_INGESTION_WARNING_TOKENS = 50_000;

type ClaudeContextUsageWarningKey = "uncached-ingestion" | "near-window";

interface ClaudeContextUsageWarning {
  readonly key: ClaudeContextUsageWarningKey;
  readonly message: string;
}

export interface ClaudeContextUsageWarningDecisions {
  readonly first: ClaudeContextUsageWarning;
  readonly second?: ClaudeContextUsageWarning;
}

export function maxClaudeContextWindowFromModelUsage(
  modelUsage: Record<string, ModelUsage> | undefined,
): number | undefined {
  if (!modelUsage) return undefined;

  let maxContextWindow: number | undefined;
  for (const value of Object.values(modelUsage)) {
    const contextWindow = asPositiveFiniteNumber(value.contextWindow);
    if (contextWindow === undefined) {
      continue;
    }
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
  }

  return maxContextWindow;
}

function finiteClaudeTokenCountOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function claudePromptTokensFromRawUsage(usage: Record<string, unknown>): number {
  return (
    finiteClaudeTokenCountOrZero(usage.input_tokens) +
    finiteClaudeTokenCountOrZero(usage.cache_creation_input_tokens) +
    finiteClaudeTokenCountOrZero(usage.cache_read_input_tokens)
  );
}

function formatApproxTokens(tokens: number): string {
  return tokens >= 1_000 ? `~${Math.round(tokens / 1_000)}k` : String(Math.round(tokens));
}

export function normalizeClaudeTokenUsage(
  value: NonNullableUsage | Record<string, unknown> | undefined,
  contextWindow?: number,
): ThreadTokenUsageSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const inputTokens = claudePromptTokensFromRawUsage(usage);
  const outputTokens = finiteClaudeTokenCountOrZero(usage.output_tokens);
  const derivedTotalProcessedTokens = inputTokens + outputTokens;
  const totalProcessedTokens =
    (typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : undefined) ?? (derivedTotalProcessedTokens > 0 ? derivedTotalProcessedTokens : undefined);
  if (totalProcessedTokens === undefined || totalProcessedTokens <= 0) {
    return undefined;
  }

  const maxTokens = asPositiveFiniteNumber(contextWindow);
  const usedTokens =
    maxTokens !== undefined ? Math.min(totalProcessedTokens, maxTokens) : totalProcessedTokens;

  return {
    usedTokens,
    lastUsedTokens: usedTokens,
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(typeof usage.tool_uses === "number" && Number.isFinite(usage.tool_uses)
      ? { toolUses: usage.tool_uses }
      : {}),
    ...(typeof usage.duration_ms === "number" && Number.isFinite(usage.duration_ms)
      ? { durationMs: usage.duration_ms }
      : {}),
  };
}

export function mergeClaudeTokenUsageSnapshot(
  previous: ThreadTokenUsageSnapshot,
  accumulated: ThreadTokenUsageSnapshot | undefined,
  contextWindow?: number,
): ThreadTokenUsageSnapshot {
  const maxTokens = asPositiveFiniteNumber(contextWindow);
  const usedTokens =
    maxTokens !== undefined ? Math.min(previous.usedTokens, maxTokens) : previous.usedTokens;
  const lastUsedTokens =
    previous.lastUsedTokens !== undefined
      ? maxTokens !== undefined
        ? Math.min(previous.lastUsedTokens, maxTokens)
        : previous.lastUsedTokens
      : usedTokens;
  const totalProcessedTokens = Math.max(
    previous.totalProcessedTokens ?? previous.usedTokens,
    accumulated?.totalProcessedTokens ?? accumulated?.usedTokens ?? 0,
    usedTokens,
  );

  return {
    ...previous,
    usedTokens,
    lastUsedTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
  };
}

export function resolveEffectiveClaudeContextWindow(input: {
  readonly reportedContextWindow: number | undefined;
  readonly lastKnownContextWindow: number | undefined;
}): number | undefined {
  const { reportedContextWindow, lastKnownContextWindow } = input;
  if (reportedContextWindow !== undefined && lastKnownContextWindow !== undefined) {
    return Math.max(reportedContextWindow, lastKnownContextWindow);
  }
  return reportedContextWindow ?? lastKnownContextWindow;
}

export function snapshotFromClaudeContextUsage(
  usage: SDKControlGetContextUsageResponse,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot {
  const effectiveMaxTokens =
    asPositiveFiniteNumber(usage.autoCompactThreshold) ??
    asPositiveFiniteNumber(usage.maxTokens) ??
    asPositiveFiniteNumber(usage.rawMaxTokens);
  const usedTokens = Math.max(0, Math.round(usage.totalTokens));
  const rawApiUsage = usage.apiUsage as Record<string, unknown> | undefined;
  const inputTokens = Math.max(
    0,
    Math.round(rawApiUsage ? claudePromptTokensFromRawUsage(rawApiUsage) : 0),
  );
  const cachedInputTokens = Math.max(
    0,
    Math.round(finiteClaudeTokenCountOrZero(rawApiUsage?.cache_read_input_tokens)),
  );
  const outputTokens = Math.max(
    0,
    Math.round(finiteClaudeTokenCountOrZero(rawApiUsage?.output_tokens)),
  );
  return {
    usedTokens:
      effectiveMaxTokens !== undefined ? Math.min(usedTokens, effectiveMaxTokens) : usedTokens,
    lastUsedTokens: usedTokens,
    ...(effectiveMaxTokens !== undefined
      ? {
          maxTokens: effectiveMaxTokens,
          usedPercent: Math.min(100, (usedTokens / effectiveMaxTokens) * 100),
        }
      : {}),
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(inputTokens > 0 ? { inputTokens, lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens > 0
      ? { cachedInputTokens, lastCachedInputTokens: cachedInputTokens }
      : {}),
    ...(outputTokens > 0 ? { outputTokens, lastOutputTokens: outputTokens } : {}),
    compactsAutomatically: usage.isAutoCompactEnabled,
  };
}

export function decideClaudeContextUsageWarnings(
  rawUsage: Record<string, unknown>,
  contextBudget: number | undefined,
  emittedWarnings: ReadonlySet<string>,
): ClaudeContextUsageWarningDecisions | undefined {
  const promptTokens = claudePromptTokensFromRawUsage(rawUsage);
  if (promptTokens <= 0) {
    return undefined;
  }

  const cachedReadTokens = finiteClaudeTokenCountOrZero(rawUsage.cache_read_input_tokens);
  const uncachedTokens = Math.max(0, promptTokens - cachedReadTokens);
  const composition =
    cachedReadTokens > 0
      ? ` (${formatApproxTokens(cachedReadTokens)} cached reads, ${formatApproxTokens(uncachedTokens)} new/cache-write)`
      : "";
  const cacheWriteTokens = finiteClaudeTokenCountOrZero(rawUsage.cache_creation_input_tokens);
  const freshInputTokens = Math.max(0, finiteClaudeTokenCountOrZero(rawUsage.input_tokens));
  let first: ClaudeContextUsageWarning | undefined;

  if (
    freshInputTokens > CLAUDE_UNCACHED_INGESTION_WARNING_TOKENS &&
    !emittedWarnings.has("uncached-ingestion")
  ) {
    first = {
      key: "uncached-ingestion",
      message: `Claude reported ${formatApproxTokens(freshInputTokens)} input tokens outside cache in one request, plus ${formatApproxTokens(cacheWriteTokens)} cache writes and ${formatApproxTokens(cachedReadTokens)} cache reads. Input includes instructions, tool definitions, history and the current message; it is not a system-prompt measurement.`,
    };
  }

  if (
    contextBudget !== undefined &&
    promptTokens > contextBudget * CLAUDE_CONTEXT_WARNING_RATIO &&
    !emittedWarnings.has("near-window")
  ) {
    const warning: ClaudeContextUsageWarning = {
      key: "near-window",
      message: `Claude context is above 80% of the ${Math.round(contextBudget / 1_000)}k provider-reported budget (${formatApproxTokens(promptTokens)} logical prompt tokens${composition}). Consider compacting or starting a fresh thread; cached reads cost less than fresh input.`,
    };
    return first ? { first, second: warning } : { first: warning };
  }

  return first ? { first } : undefined;
}
