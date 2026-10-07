// A runaway guard, not a context budget: Claude and Codex own their history and compact it, so
// the images a turn returns do not all stay in context. A turn that needs more than this many
// screenshots is looping; it must work from the accessibility tree or finish.
export const MAX_IMAGES_PER_TURN = 60;

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
  // The turn of each thread's latest computer call, unless that turn was stopped. The turn may
  // have ended since; callers check before acting on it.
  readonly activeTurns: () => ReadonlyArray<{ readonly threadId: string; readonly turnId: string }>;
  // When an agent action last drove the real pointer or keyboard (any thread), so the user-activity
  // check can tell the agent's own input from the user's.
  readonly markRealInput: () => void;
  readonly lastRealInputAt: () => number;
  readonly clearThread: (threadId: string) => void;
}

interface ThreadTask {
  readonly inFlight: Set<AbortController>;
  turnId: string | null;
  stoppedTurnId: string | null;
  imageTurnId: string | null;
  images: number;
}

export function makeComputerTasks(): ComputerTasks {
  const threads = new Map<string, ThreadTask>();
  let realInputAt = 0;
  const task = (threadId: string) => {
    let entry = threads.get(threadId);
    if (!entry) {
      entry = {
        inFlight: new Set(),
        turnId: null,
        stoppedTurnId: null,
        imageTurnId: null,
        images: 0,
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
    activeTurns: () =>
      [...threads.entries()].flatMap(([threadId, entry]) =>
        entry.turnId !== null && entry.stoppedTurnId !== entry.turnId
          ? [{ threadId, turnId: entry.turnId }]
          : [],
      ),
    markRealInput: () => {
      realInputAt = Date.now();
    },
    lastRealInputAt: () => realInputAt,
    clearThread: (threadId) => {
      const entry = threads.get(threadId);
      for (const controller of entry?.inFlight ?? []) controller.abort();
      threads.delete(threadId);
    },
  };
}
