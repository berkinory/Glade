// Clicks within this window join the attempt in flight. One that has not settled by then is
// treated as lost, so "New thread" starts over instead of waiting until a reload.
const DRAFT_NAVIGATION_COALESCE_WINDOW_MS = 5_000;

const inFlightDraftNavigationBySlot = new Map<
  string,
  {
    readonly operation: Promise<unknown>;
    readonly startedAt: number;
    readonly controller: AbortController;
  }
>();

export function draftNavigationSlotKey(projectId: string): string {
  return projectId;
}

export function runDraftNavigationOnce<T>(
  slotKey: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const existing = inFlightDraftNavigationBySlot.get(slotKey);
  if (existing && Date.now() - existing.startedAt < DRAFT_NAVIGATION_COALESCE_WINDOW_MS) {
    return existing.operation as Promise<T>;
  }

  // The retry owns the slot; an expired attempt must not stage or navigate if it wakes up later.
  existing?.controller.abort();
  const controller = new AbortController();
  const operation = Promise.resolve().then(() => run(controller.signal));
  inFlightDraftNavigationBySlot.set(slotKey, { operation, startedAt: Date.now(), controller });
  const clearOperation = () => {
    if (inFlightDraftNavigationBySlot.get(slotKey)?.operation === operation) {
      inFlightDraftNavigationBySlot.delete(slotKey);
    }
  };
  void operation.then(clearOperation, clearOperation);
  return operation;
}

export async function stageDraftNavigation(input: {
  readonly signal: AbortSignal;
  readonly stage: () => void;
  readonly navigate: () => Promise<void>;
  readonly isDestinationActive: () => boolean;
  readonly finalize: () => void;
  readonly rollback: () => void;
}): Promise<boolean> {
  let rolledBack = false;
  const rollbackOnce = () => {
    if (rolledBack) {
      return;
    }
    rolledBack = true;
    input.rollback();
  };

  if (input.signal.aborted) {
    return false;
  }
  try {
    input.stage();
    await input.navigate();
    if (input.signal.aborted || !input.isDestinationActive()) {
      rollbackOnce();
      return false;
    }
    input.finalize();
    return true;
  } catch (error) {
    rollbackOnce();
    throw error;
  }
}
