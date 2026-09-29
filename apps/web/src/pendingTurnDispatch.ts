import type { ThreadId } from "@glade/contracts";

// The catch-up watchdog otherwise re-syncs only threads the store already believes are busy. A lost
// `thread.session-set(running)` event corrupts exactly that belief, so the watchdog needs a signal
// that does not come from the store: "the composer dispatched a turn here that the projection has
// not yet confirmed". Lifecycle — deliberately independent of the composer's own dispatch state,
// which clears on UI-level acknowledgement (message echo, ack fallback) that can fire off a stream
// that then stalls before the running transition: - armed when the composer begins a dispatch, and
// re-armed when the turn RPC resolves (pre-dispatch work like worktree setup can outlive the age
// cap); - cleared at the dispatch site when the turn RPC fails or rollback confirms that no server
// turn remains; - otherwise expired by the age cap below.
const pendingDispatchArmedAtByThreadId = new Map<ThreadId, number>();

const PENDING_TURN_DISPATCH_MAX_AGE_MS = 30_000;

export function markPendingTurnDispatch(threadId: ThreadId): void {
  pendingDispatchArmedAtByThreadId.set(threadId, Date.now());
}

export function clearPendingTurnDispatch(threadId: ThreadId): void {
  pendingDispatchArmedAtByThreadId.delete(threadId);
}

export function hasPendingTurnDispatch(threadId: ThreadId): boolean {
  const armedAt = pendingDispatchArmedAtByThreadId.get(threadId);
  if (armedAt === undefined) {
    return false;
  }
  if (Date.now() - armedAt > PENDING_TURN_DISPATCH_MAX_AGE_MS) {
    pendingDispatchArmedAtByThreadId.delete(threadId);
    return false;
  }
  return true;
}
