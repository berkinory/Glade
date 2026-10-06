import {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
} from "@glade/contracts/orchestration/rpc";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { queryOptions } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { ensureNativeApi } from "../nativeApi";
import {
  expensiveReadErrorRefetchInterval,
  expensiveReadRetryDelay,
  isRpcCapacityExceededError,
  shouldRetryExpensiveRead,
} from "./expensiveReadRetry";

interface CheckpointDiffQueryInput {
  threadId: ThreadId | null;
  fromTurnCount: number | null;
  toTurnCount: number | null;
  ignoreWhitespace: boolean;
  cacheScope?: string | null;
  live?: boolean;
  enabled?: boolean;
}

export const providerQueryKeys = {
  threadCheckpointDiffs: (threadId: ThreadId) => ["providers", "checkpointDiff", threadId] as const,
  checkpointDiff: (input: CheckpointDiffQueryInput) =>
    [
      "providers",
      "checkpointDiff",
      input.threadId,
      input.fromTurnCount,
      input.toTurnCount,
      input.ignoreWhitespace,
      input.cacheScope ?? null,
    ] as const,
};

const CHECKPOINT_DIFF_PENDING_REFETCH_INTERVAL_MS = 2_000;
const CHECKPOINT_DIFF_PENDING_REFETCH_MAX_ATTEMPTS = 12;

function shouldUseFullThreadDiffApi(input: CheckpointDiffQueryInput): boolean {
  return (
    input.fromTurnCount === 0 &&
    typeof input.cacheScope === "string" &&
    input.cacheScope.startsWith("conversation:")
  );
}

function decodeCheckpointDiffRequest(input: CheckpointDiffQueryInput) {
  if (shouldUseFullThreadDiffApi(input)) {
    return Schema.decodeUnknownOption(OrchestrationGetFullThreadDiffInput)({
      threadId: input.threadId,
      toTurnCount: input.toTurnCount,
      ignoreWhitespace: input.ignoreWhitespace,
    }).pipe(Option.map((fields) => ({ kind: "fullThreadDiff" as const, input: fields })));
  }

  return Schema.decodeUnknownOption(OrchestrationGetTurnDiffInput)({
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    ignoreWhitespace: input.ignoreWhitespace,
  }).pipe(Option.map((fields) => ({ kind: "turnDiff" as const, input: fields })));
}

function asCheckpointErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function normalizeCheckpointErrorMessage(error: unknown): string {
  const message = asCheckpointErrorMessage(error).trim();
  if (message.length === 0) {
    return "Failed to load checkpoint diff.";
  }

  const lower = message.toLowerCase();
  if (lower.includes("not a git repository")) {
    return "Turn diffs are unavailable because this project is not a git repository.";
  }

  if (
    lower.includes("checkpoint unavailable for thread") ||
    lower.includes("checkpoint invariant violation")
  ) {
    const separatorIndex = message.indexOf(":");
    if (separatorIndex >= 0) {
      const detail = message.slice(separatorIndex + 1).trim();
      if (detail.length > 0) {
        return detail;
      }
    }
  }

  return message;
}

function isCheckpointTemporarilyUnavailable(error: unknown): boolean {
  const message = asCheckpointErrorMessage(error).toLowerCase();
  return (
    message.includes("exceeds current turn count") ||
    message.includes("checkpoint diff is not available yet")
  );
}

export function checkpointDiffQueryOptions(input: CheckpointDiffQueryInput) {
  const decodedRequest = decodeCheckpointDiffRequest(input);

  return queryOptions({
    queryKey: providerQueryKeys.checkpointDiff(input),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.threadId || decodedRequest._tag === "None") {
        throw new Error("Checkpoint diff is unavailable.");
      }
      try {
        if (decodedRequest.value.kind === "fullThreadDiff") {
          return await api.orchestration.getFullThreadDiff(decodedRequest.value.input);
        }
        return await api.orchestration.getTurnDiff(decodedRequest.value.input);
      } catch (error) {
        if (isRpcCapacityExceededError(error)) throw error;
        throw new Error(normalizeCheckpointErrorMessage(error), { cause: error });
      }
    },
    enabled: (input.enabled ?? true) && !!input.threadId && decodedRequest._tag === "Some",
    staleTime: Infinity,
    gcTime: input.live ? 0 : 5 * 60_000,
    retry: (failureCount, error) => {
      if (isRpcCapacityExceededError(error)) {
        return shouldRetryExpensiveRead(failureCount, error);
      }
      if (isCheckpointTemporarilyUnavailable(error)) {
        return failureCount < 12;
      }
      return failureCount < 3;
    },
    retryDelay: (attempt, error) => {
      if (isRpcCapacityExceededError(error)) {
        return expensiveReadRetryDelay(attempt, error);
      }
      return isCheckpointTemporarilyUnavailable(error)
        ? Math.min(5_000, 250 * 2 ** (attempt - 1))
        : Math.min(1_000, 100 * 2 ** (attempt - 1));
    },
    refetchInterval: (query) => {
      if (isRpcCapacityExceededError(query.state.error)) {
        return expensiveReadErrorRefetchInterval(query);
      }
      const temporaryError = query.state.error;
      if (!temporaryError || !isCheckpointTemporarilyUnavailable(temporaryError)) {
        return false;
      }
      const temporaryErrorCount = query.state.errorUpdateCount ?? 0;
      return temporaryErrorCount < CHECKPOINT_DIFF_PENDING_REFETCH_MAX_ATTEMPTS
        ? CHECKPOINT_DIFF_PENDING_REFETCH_INTERVAL_MS
        : false;
    },
  });
}
