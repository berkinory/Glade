// FILE: threadUnblock.ts
// Purpose: Abandons the provider delivery blockers that quarantine a thread.
// Layer: Web orchestration helper
// Exports: unblockThreadFromClient

import type { NativeApi, ThreadId } from "@glade/contracts";

/** Code the server returns when a blocker no longer matches the requested state. */
const PROVIDER_DELIVERY_RECONCILIATION_CONFLICT_CODE = "PROVIDER_DELIVERY_RECONCILIATION_CONFLICT";

const UNBLOCK_NOTE = "Abandoned while resuming the thread; the command was never confirmed.";

type ThreadUnblockApi = Pick<
  NativeApi["orchestration"],
  "listProviderDeliveryBlockers" | "reconcileProviderDelivery"
>;

/**
 * The reconciliation conflict is expected, not exceptional: two clients (or a
 * client and a server restart) can race to settle the same blocker.
 */
function isProviderDeliveryReconciliationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === PROVIDER_DELIVERY_RECONCILIATION_CONFLICT_CODE
  );
}

/**
 * Settles every delivery that keeps a thread quarantined by abandoning it: the
 * ambiguous command is never replayed (it may have reached the provider), but
 * the server replays the side effects that were skipped after it, so messages
 * sent while the thread was blocked are dispatched again.
 *
 * Blockers are reconciled oldest-first because abandoning one replays the
 * commands that follow it, which can settle the later blockers on its own.
 */
export async function unblockThreadFromClient(
  api: ThreadUnblockApi,
  threadId: ThreadId,
): Promise<void> {
  const blockers = await api.listProviderDeliveryBlockers({ threadId });
  if (blockers.length === 0) return;
  const ordered = blockers.toSorted((left, right) => left.eventSequence - right.eventSequence);
  for (const blocker of ordered) {
    try {
      await api.reconcileProviderDelivery({
        eventSequence: blocker.eventSequence,
        threadId,
        expectedState: blocker.state,
        outcome: "abandon",
        note: UNBLOCK_NOTE,
      });
    } catch (error) {
      if (!isProviderDeliveryReconciliationConflict(error)) throw error;
    }
  }
  const remaining = await api.listProviderDeliveryBlockers({ threadId, limit: 1 });
  if (remaining.length > 0) {
    throw new Error("The thread is still blocked by a provider failure. Try sending again.");
  }
}
