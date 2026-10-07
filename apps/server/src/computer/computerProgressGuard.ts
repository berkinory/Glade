// Refuses an action the agent keeps repeating without any observed effect: the same tool with the
// same arguments on the same window, whose earlier attempts Cua could not confirm and that changed
// nothing in the window's tree. Reading the window again (or any different action) resets it, so
// the refusal steers the model to look before it tries again; Glade never replays an action itself.
export const MAX_UNOBSERVED_REPEATS = 2;

export interface ComputerProgressGuard {
  // True when this action already ran MAX_UNOBSERVED_REPEATS times in a row with no effect.
  readonly blocked: (threadId: string, actionKey: string) => boolean;
  readonly recordAction: (threadId: string, actionKey: string, observedEffect: boolean) => void;
  // A fresh look at the app (window state, screenshot, zoom, verify) clears the streak.
  readonly recordRead: (threadId: string) => void;
  readonly clearThread: (threadId: string) => void;
}

export function makeComputerProgressGuard(): ComputerProgressGuard {
  const streaks = new Map<string, { readonly key: string; readonly count: number }>();
  return {
    blocked: (threadId, actionKey) => {
      const streak = streaks.get(threadId);
      return streak?.key === actionKey && streak.count >= MAX_UNOBSERVED_REPEATS;
    },
    recordAction: (threadId, actionKey, observedEffect) => {
      if (observedEffect) {
        streaks.delete(threadId);
        return;
      }
      const streak = streaks.get(threadId);
      streaks.set(threadId, {
        key: actionKey,
        count: streak?.key === actionKey ? streak.count + 1 : 1,
      });
    },
    recordRead: (threadId) => {
      streaks.delete(threadId);
    },
    clearThread: (threadId) => {
      streaks.delete(threadId);
    },
  };
}
