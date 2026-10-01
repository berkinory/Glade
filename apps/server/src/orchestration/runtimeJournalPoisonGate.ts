const RUNTIME_JOURNAL_POISON_DRAIN_LIMIT = 240;
const RUNTIME_JOURNAL_POISON_MIN_BLOCKED_MS = 60_000;

export interface RuntimeJournalPoisonGate {
  readonly noteBlockedDrain: (cursor: number, nowMs: number) => boolean;

  readonly reset: () => void;
}

export function makeRuntimeJournalPoisonGate(options?: {
  readonly attemptLimit?: number;
  readonly minBlockedMs?: number;
}): RuntimeJournalPoisonGate {
  const attemptLimit = Math.max(1, options?.attemptLimit ?? RUNTIME_JOURNAL_POISON_DRAIN_LIMIT);
  const minBlockedMs = Math.max(0, options?.minBlockedMs ?? RUNTIME_JOURNAL_POISON_MIN_BLOCKED_MS);

  let blockedCursor: number | null = null;
  let blockedCount = 0;
  let blockedSinceMs = 0;

  return {
    noteBlockedDrain: (cursor, nowMs) => {
      if (blockedCursor === cursor) {
        blockedCount += 1;
      } else {
        blockedCursor = cursor;
        blockedCount = 1;
        blockedSinceMs = nowMs;
      }
      return blockedCount >= attemptLimit && nowMs - blockedSinceMs >= minBlockedMs;
    },
    reset: () => {
      blockedCursor = null;
      blockedCount = 0;
      blockedSinceMs = 0;
    },
  };
}
