// Screenshots stay in the provider's context for the rest of the turn; past this many the model
// must work from the accessibility tree or finish.
export const MAX_IMAGES_PER_TURN = 20;

interface ComputerCall {
  readonly signal: AbortSignal;
  readonly end: () => void;
}

export interface ComputerTasks {
  // Registers one in-flight computer call of the thread's turn; Stop aborts its signal.
  readonly begin: (threadId: string, turnId: string | null) => ComputerCall;
  // Stop from the chat or Escape: aborts in-flight calls, and every later call of that turn, so
  // neither background nor foreground input continues. Without a turn id it applies to the turn of
  // the latest call.
  readonly stop: (threadId: string, turnId?: string) => void;
  // Counts one returned image against the turn's budget; false once it is spent.
  readonly takeImage: (threadId: string, turnId: string | null) => boolean;
  readonly rememberElements: (
    threadId: string,
    window: { readonly pid: number; readonly windowId: number },
    tokens: ReadonlyMap<number, string>,
  ) => void;
  readonly elementToken: (
    threadId: string,
    window: { readonly pid: number; readonly windowId: number },
    index: number,
  ) => string | null;
  readonly clearThread: (threadId: string) => void;
}

interface ThreadTask {
  readonly inFlight: Set<AbortController>;
  turnId: string | null;
  stoppedTurnId: string | null;
  imageTurnId: string | null;
  images: number;
  // element_index → element_token of the latest snapshot per window. Cua stales a token once a
  // newer snapshot of its window exists, so only the latest one is kept.
  readonly elements: Map<string, ReadonlyMap<number, string>>;
}

const windowKey = (window: { readonly pid: number; readonly windowId: number }) =>
  `${window.pid}:${window.windowId}`;

export function makeComputerTasks(): ComputerTasks {
  const threads = new Map<string, ThreadTask>();
  const task = (threadId: string) => {
    let entry = threads.get(threadId);
    if (!entry) {
      entry = {
        inFlight: new Set(),
        turnId: null,
        stoppedTurnId: null,
        imageTurnId: null,
        images: 0,
        elements: new Map(),
      };
      threads.set(threadId, entry);
    }
    return entry;
  };

  return {
    begin: (threadId, turnId) => {
      const entry = task(threadId);
      entry.turnId = turnId;
      const controller = new AbortController();
      if (turnId !== null && entry.stoppedTurnId === turnId) controller.abort();
      entry.inFlight.add(controller);
      return { signal: controller.signal, end: () => entry.inFlight.delete(controller) };
    },
    stop: (threadId, turnId) => {
      const entry = task(threadId);
      entry.stoppedTurnId = turnId ?? entry.turnId;
      for (const controller of entry.inFlight) controller.abort();
      entry.inFlight.clear();
    },
    takeImage: (threadId, turnId) => {
      const entry = task(threadId);
      if (entry.imageTurnId !== turnId) {
        entry.imageTurnId = turnId;
        entry.images = 0;
      }
      if (entry.images >= MAX_IMAGES_PER_TURN) return false;
      entry.images += 1;
      return true;
    },
    rememberElements: (threadId, window, tokens) => {
      task(threadId).elements.set(windowKey(window), tokens);
    },
    elementToken: (threadId, window, index) =>
      threads.get(threadId)?.elements.get(windowKey(window))?.get(index) ?? null,
    clearThread: (threadId) => {
      const entry = threads.get(threadId);
      for (const controller of entry?.inFlight ?? []) controller.abort();
      threads.delete(threadId);
    },
  };
}
