import { WS_STREAM_LIMITS } from "@glade/contracts/transport/ws/wsCompatibility";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { useSyncExternalStore } from "react";
import { useStore } from "./store";
import type { AppState } from "./storeState";

const THREAD_DETAIL_RETENTION_EVICTION_MS = 10 * 60 * 1000;
// A client-side memory cache, not a stream budget: concurrent server subscriptions stay capped at
// `WS_STREAM_LIMITS.threadPerClient` by `resolveThreadDetailSubscriptionLeaseIds`. Only idle
// entries count (released, hidden and not live), so threads that are retained, visible or running
// never compete for these slots. A full thread holds up to a few MB of messages and activity
// payloads, so this keeps the recently left threads warm without hoarding a whole session's worth.
const MAX_IDLE_THREAD_DETAILS = 8;

type RetainedThreadEntry = {
  refCount: number;
  lastAccessedAt: number;
  evictionTimeout: ReturnType<typeof setTimeout> | null;
};

const retainedThreadEntries = new Map<ThreadId, RetainedThreadEntry>();
const listeners = new Set<() => void>();
const evictionListeners = new Set<(threadId: ThreadId) => void>();
let cachedSnapshot: readonly ThreadId[] = [];
let visibleThreadIds: ReadonlySet<ThreadId> = new Set();

function emitChange(): void {
  cachedSnapshot = [...retainedThreadEntries.keys()];
  for (const listener of listeners) {
    listener();
  }
}

function emitEviction(threadId: ThreadId): void {
  for (const listener of evictionListeners) {
    try {
      listener(threadId);
    } catch {
      // Eviction listeners must not break retention bookkeeping.
    }
  }
}

// Visibility and active retain handles are checked separately; terminal hidden children must remain
// evictable so completed subagents cannot leak forever.
function isThreadDetailEvictionUnsafe(threadId: ThreadId): boolean {
  const state = useStore.getState();
  const sidebarThread = state.sidebarThreadSummaryById[threadId];

  if (sidebarThread) {
    const orchestrationStatus = sidebarThread.session?.orchestrationStatus;
    if (
      orchestrationStatus &&
      orchestrationStatus !== "idle" &&
      orchestrationStatus !== "stopped"
    ) {
      return true;
    }

    if (sidebarThread.latestTurn?.state === "running") {
      return true;
    }
  }

  const threadShell = state.threadShellById?.[threadId];
  if (!threadShell) {
    // Claude subagent children can have detail without a shell/sidebar row. Their normalized lifecycle
    // slices still tell us whether eviction would discard live work. Once terminal, the retain timeout
    // and capacity limit must be allowed to reclaim them or every completed child leaks forever.
    const hiddenSession = state.threadSessionById?.[threadId];
    const hiddenTurnState = state.threadTurnStateById?.[threadId];
    return (
      hiddenSession?.orchestrationStatus === "starting" ||
      hiddenSession?.orchestrationStatus === "running" ||
      hiddenTurnState?.latestTurn?.state === "running"
    );
  }

  const session = state.threadSessionById?.[threadId];
  const turnState = state.threadTurnStateById?.[threadId];
  const orchestrationStatus = session?.orchestrationStatus;
  return (
    Boolean(
      orchestrationStatus && orchestrationStatus !== "idle" && orchestrationStatus !== "stopped",
    ) || turnState?.latestTurn?.state === "running"
  );
}

function shouldReconcileThreadDetailRetention(current: AppState, previous: AppState): boolean {
  return (
    current.sidebarThreadSummaryById !== previous.sidebarThreadSummaryById ||
    current.threadShellById !== previous.threadShellById ||
    current.threadSessionById !== previous.threadSessionById ||
    current.threadTurnStateById !== previous.threadTurnStateById
  );
}

function shouldEvictEntry(threadId: ThreadId, entry: RetainedThreadEntry): boolean {
  return (
    entry.refCount === 0 &&
    !visibleThreadIds.has(threadId) &&
    !isThreadDetailEvictionUnsafe(threadId)
  );
}

export function setVisibleThreadDetailIds(threadIds: readonly ThreadId[]): void {
  if (
    visibleThreadIds.size === threadIds.length &&
    threadIds.every((threadId) => visibleThreadIds.has(threadId))
  ) {
    return;
  }
  visibleThreadIds = new Set(threadIds);
  reconcileRetentionEntries();
}

function clearEvictionTimeout(entry: RetainedThreadEntry): void {
  if (entry.evictionTimeout === null) {
    return;
  }
  clearTimeout(entry.evictionTimeout);
  entry.evictionTimeout = null;
}

function evictEntry(
  threadId: ThreadId,
  entry: RetainedThreadEntry,
  options?: { readonly notify?: boolean },
): void {
  clearEvictionTimeout(entry);
  if (!retainedThreadEntries.delete(threadId)) {
    return;
  }

  useStore.getState().evictThreadDetail(threadId);
  emitEviction(threadId);
  if (options?.notify !== false) {
    emitChange();
  }
}

function scheduleEviction(threadId: ThreadId, entry: RetainedThreadEntry): void {
  clearEvictionTimeout(entry);
  if (!shouldEvictEntry(threadId, entry)) {
    return;
  }
  const remainingMs = Math.max(
    0,
    entry.lastAccessedAt + THREAD_DETAIL_RETENTION_EVICTION_MS - Date.now(),
  );
  entry.evictionTimeout = setTimeout(() => {
    const currentEntry = retainedThreadEntries.get(threadId);
    if (currentEntry) {
      currentEntry.evictionTimeout = null;
    }
    if (!currentEntry || !shouldEvictEntry(threadId, currentEntry)) {
      return;
    }
    evictEntry(threadId, currentEntry);
  }, remainingMs);
}

function idleEntries(): [ThreadId, RetainedThreadEntry][] {
  return [...retainedThreadEntries.entries()].filter((entry) =>
    shouldEvictEntry(entry[0], entry[1]),
  );
}

function evictIdleEntriesToCapacity(): void {
  const candidates = idleEntries();
  if (candidates.length <= MAX_IDLE_THREAD_DETAILS) {
    return;
  }

  let changed = false;
  for (const [threadId] of candidates.toSorted(
    (left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt,
  )) {
    // Eviction re-enters through the store subscriber, so the live count is re-read every step.
    if (idleEntries().length <= MAX_IDLE_THREAD_DETAILS) {
      break;
    }
    const entry = retainedThreadEntries.get(threadId);
    if (!entry || !shouldEvictEntry(threadId, entry)) {
      continue;
    }
    evictEntry(threadId, entry, { notify: false });
    changed = true;
  }
  if (changed) {
    emitChange();
  }
}

function reconcileRetentionEntries(): void {
  for (const [threadId, entry] of retainedThreadEntries) {
    if (shouldEvictEntry(threadId, entry)) {
      if (entry.evictionTimeout === null) {
        scheduleEviction(threadId, entry);
      }
    } else {
      clearEvictionTimeout(entry);
    }
  }
  evictIdleEntriesToCapacity();
}

// This reconcile is re-entrant by design: it can evict, and eviction writes to the store, which
// synchronously runs this subscriber again. It stays correct because `evictEntry` deletes its entry
// before touching the store, and every step re-reads the live map, so a nested pass can only evict
// entries the outer pass has not claimed. The eviction notice is the one part that must not run
// inline — lease owners answer it by queueing a stream refresh rather than writing state here.
useStore.subscribe((current, previous) => {
  if (!shouldReconcileThreadDetailRetention(current, previous)) {
    return;
  }
  reconcileRetentionEntries();
});

export function retainThreadDetailSubscription(threadId: ThreadId): () => void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseThreadDetailSubscription(threadId);
  };
  const existing = retainedThreadEntries.get(threadId);
  if (existing) {
    clearEvictionTimeout(existing);
    existing.refCount += 1;
    existing.lastAccessedAt = Date.now();
    return release;
  }

  retainedThreadEntries.set(threadId, {
    refCount: 1,
    lastAccessedAt: Date.now(),
    evictionTimeout: null,
  });
  emitChange();
  evictIdleEntriesToCapacity();

  return release;
}

function releaseThreadDetailSubscription(threadId: ThreadId): void {
  const entry = retainedThreadEntries.get(threadId);
  if (!entry) {
    return;
  }

  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastAccessedAt = Date.now();
  if (entry.refCount > 0) {
    return;
  }

  scheduleEviction(threadId, entry);
  evictIdleEntriesToCapacity();
}

function subscribeRetainedThreadDetailIds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeThreadDetailEvictions(listener: (threadId: ThreadId) => void): () => void {
  evictionListeners.add(listener);
  return () => {
    evictionListeners.delete(listener);
  };
}

function getRetainedThreadDetailIdsSnapshot(): readonly ThreadId[] {
  return cachedSnapshot;
}

// Subscription owners check this when a stream lease drops: detail that no retention entry owns and
// no lease references would otherwise stay in the store for the session's lifetime, because
// eviction only ever runs from a retention entry.
export function isThreadDetailRetained(threadId: ThreadId): boolean {
  return retainedThreadEntries.has(threadId);
}

export function resolveThreadDetailSubscriptionLeaseIds(input: {
  readonly visibleThreadIds: readonly ThreadId[];
  readonly retainedThreadIds: readonly ThreadId[];
  readonly serverThreadIds: ReadonlySet<ThreadId>;
}): ThreadId[] {
  const threadIds = new Set<ThreadId>();
  for (const threadId of input.visibleThreadIds) {
    if (threadIds.size >= WS_STREAM_LIMITS.threadPerClient) break;

    threadIds.add(threadId);
  }
  // Leases are capped below the retention cache, so retained threads compete for the slots left after
  // visible ones. Live work goes first: a running thread that loses its lease freezes mid-turn, and
  // reopening it has to replay the whole gap.
  const leasableThreadIds = input.retainedThreadIds.filter((threadId) =>
    input.serverThreadIds.has(threadId),
  );
  for (const threadId of [
    ...leasableThreadIds.filter(isThreadDetailEvictionUnsafe),
    ...leasableThreadIds,
  ]) {
    if (threadIds.size >= WS_STREAM_LIMITS.threadPerClient) break;
    threadIds.add(threadId);
  }
  return [...threadIds];
}

export function useRetainedThreadDetailIds(): readonly ThreadId[] {
  return useSyncExternalStore(
    subscribeRetainedThreadDetailIds,
    getRetainedThreadDetailIdsSnapshot,
    getRetainedThreadDetailIdsSnapshot,
  );
}
