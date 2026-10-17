import { Throttler } from "@tanstack/react-pacer";

// Running agents complete tools several times a second per thread. Two seconds caps each checkout at one
// refetch wave per window while staying shorter than a typical tool step, so the file tree and git state
// still read as live; the trailing edge always re-reads after the last completion.
export const CWD_REFRESH_INTERVAL_MS = 2_000;

export interface CwdRefreshThrottle {
  refresh: (cwds: Iterable<string>) => void;
  cancel: () => void;
}

export function createCwdRefreshThrottle(refresh: (cwd: string) => void): CwdRefreshThrottle {
  const throttlers = new Map<string, Throttler<() => void>>();

  // An idle throttler past its window behaves exactly like a new one, so dropping it keeps the map
  // limited to checkouts touched within the last window.
  const pruneIdle = (now: number) => {
    for (const [cwd, throttler] of throttlers) {
      const { isPending, lastExecutionTime } = throttler.store.state;
      if (!isPending && now - lastExecutionTime >= CWD_REFRESH_INTERVAL_MS) throttlers.delete(cwd);
    }
  };

  return {
    refresh: (cwds) => {
      pruneIdle(Date.now());
      for (const cwd of new Set(cwds)) {
        let throttler = throttlers.get(cwd);
        if (!throttler) {
          throttler = new Throttler(() => refresh(cwd), {
            wait: CWD_REFRESH_INTERVAL_MS,
            leading: true,
            trailing: true,
          });
          throttlers.set(cwd, throttler);
        }
        throttler.maybeExecute();
      }
    },
    cancel: () => {
      for (const throttler of throttlers.values()) throttler.cancel();
      throttlers.clear();
    },
  };
}
