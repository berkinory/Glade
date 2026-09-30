import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { parseClaudeTrackedTasks, hasUnfinishedClaudeTasks } from "../claudeTaskTracker.ts";
import { Schema } from "effect";
import { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import { type ThreadTokenUsageSnapshot } from "@glade/contracts/provider/runtimePayloads";
import { ClaudeResumeState, ClaudeSessionContext } from "./sessionTypes";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

export function hasDurableClaudeSessionId(message: SDKMessage): boolean {
  if (message.type !== "system") {
    return true;
  }

  return (
    message.subtype !== "hook_started" &&
    message.subtype !== "hook_progress" &&
    message.subtype !== "hook_response"
  );
}

export function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
    trackedTasks?: unknown;
    processedTokenTotal?: unknown;
    tokenAccountingVersion?: unknown;
    claudeCache?: unknown;
  };

  const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : undefined;
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.makeUnsafe(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt =
    typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : undefined;
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;
  const trackedTasks = parseClaudeTrackedTasks(cursor.trackedTasks);
  const processedTokenTotal =
    typeof cursor.processedTokenTotal === "number" &&
    Number.isSafeInteger(cursor.processedTokenTotal) &&
    cursor.processedTokenTotal >= 0
      ? cursor.processedTokenTotal
      : undefined;

  return {
    ...(Schema.is(ClaudeCacheObservation)(cursor.claudeCache) &&
    cursor.claudeCache.nativeSessionId === resume
      ? { claudeCache: cursor.claudeCache }
      : {}),
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnCountValue !== undefined && Number.isInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
    ...(trackedTasks.length > 0 ? { trackedTasks } : {}),
    ...(processedTokenTotal !== undefined && cursor.tokenAccountingVersion === 1
      ? { processedTokenTotal, tokenAccountingVersion: 1 as const }
      : {}),
  };
}

export function withoutProcessedTokenTotal(
  snapshot: ThreadTokenUsageSnapshot,
): ThreadTokenUsageSnapshot {
  const { totalProcessedTokens: _totalProcessedTokens, ...contextUsage } = snapshot;
  return contextUsage;
}

export function invalidateClaudeCache(context: ClaudeSessionContext): void {
  delete context.cacheObservation;
  delete context.cacheRequestStartedAt;
  context.hasObservedCacheRequest = false;
  if (context.lastKnownTokenUsage?.claudeCache) {
    const { claudeCache: _claudeCache, ...usage } = context.lastKnownTokenUsage;
    context.lastKnownTokenUsage = usage;
  }
}

export function syncClaudeCacheResumeCursor(context: ClaudeSessionContext): void {
  const { claudeCache: _previous, ...resumeCursor } = context.session.resumeCursor as Record<
    string,
    unknown
  >;

  context.session = {
    ...context.session,
    resumeCursor: {
      ...resumeCursor,
      ...(context.cacheObservation ? { claudeCache: context.cacheObservation } : {}),
    },
  };
}

export function hasActiveClaudeRuntimeWork(context: ClaudeSessionContext): boolean {
  return (
    context.turnState !== undefined ||
    context.knownBackgroundTaskIds.size > 0 ||
    context.liveWorkflowTaskIds.size > 0 ||
    context.pendingApprovals.size > 0 ||
    context.pendingUserInputs.size > 0 ||
    Array.from(context.subagentRuns.values()).some((run) => run.context.turnState !== undefined)
  );
}

export function hasActiveClaudeCompactionWork(context: ClaudeSessionContext): boolean {
  return hasActiveClaudeRuntimeWork(context) || hasUnfinishedClaudeTasks(context.trackedTasks);
}
