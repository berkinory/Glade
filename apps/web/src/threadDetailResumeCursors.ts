import type { OrchestrationSubscribeThreadInput } from "@glade/contracts/orchestration/orchestration";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

// Invariant: a cursor exists for a thread only while the store's cached detail is coherent up to
// that sequence. The store projection layer enforces this structurally — every transition that
// wipes detail slices (thread removal, eviction, full-sync pruning) drops the cursor in the same
// step — and the subscription layer covers the store-independent paths (dead stream, snapshot
// discarded before application). A cursor without its detail would make a resubscribe resume on top
// of missing history. A cursor is also only meaningful against the server journal that issued its
// sequences, so a server-identity change must drop all of them (see
// resetThreadDetailResumeCursors).
const resumeCursorByThreadId = new Map<ThreadId, number>();

export function advanceThreadDetailResumeCursor(threadId: ThreadId, sequence: number): void {
  const current = resumeCursorByThreadId.get(threadId);
  if (current === undefined || sequence > current) {
    resumeCursorByThreadId.set(threadId, sequence);
  }
}

export function setThreadDetailResumeCursor(threadId: ThreadId, sequence: number): void {
  resumeCursorByThreadId.set(threadId, sequence);
}

export function getThreadDetailResumeCursor(threadId: ThreadId): number | undefined {
  return resumeCursorByThreadId.get(threadId);
}

export function hasThreadDetailResumeCursor(threadId: ThreadId): boolean {
  return resumeCursorByThreadId.has(threadId);
}

export function clearThreadDetailResumeCursor(threadId: ThreadId): void {
  resumeCursorByThreadId.delete(threadId);
}

export function retainThreadDetailResumeCursors(threadIds: ReadonlySet<ThreadId>): void {
  for (const threadId of resumeCursorByThreadId.keys()) {
    if (!threadIds.has(threadId)) {
      resumeCursorByThreadId.delete(threadId);
    }
  }
}

export function resetThreadDetailResumeCursors(): void {
  resumeCursorByThreadId.clear();
}

// Subscription input for a thread stream: cursor resume when cached detail is still valid,
// full-history snapshot otherwise. Every subscribeThread call must go through this so the cursor
// decision lives in exactly one place.
export function buildThreadSubscribeInput(threadId: ThreadId): OrchestrationSubscribeThreadInput {
  const afterSequence = resumeCursorByThreadId.get(threadId);
  return afterSequence === undefined ? { threadId } : { threadId, afterSequence };
}
