import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Duration, Effect, type Fiber } from "effect";

export interface WarmLaunch {
  // Everything the launch was started from; a start claims the launch only when its key matches.
  readonly key: string;
  readonly release: Effect.Effect<void>;
}

interface ParkedEntry<L extends WarmLaunch> {
  readonly launch: L;
}

/**
 * Owns launched-but-unclaimed Claude runtimes, at most one per thread. Removing an entry from the
 * map transfers ownership, so a claim and an expiry can never both use the same launch.
 */
export function makeClaudeWarmLaunches<L extends WarmLaunch>(options: {
  readonly ttl: Duration.Input;
  readonly capacity: number;
  readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
}) {
  const parked = new Map<ThreadId, ParkedEntry<L>>();

  const scheduleExpiry = (threadId: ThreadId, entry: ParkedEntry<L>) => {
    // A claimed or refreshed entry is a different object, so a stale timer finds nothing to release.
    options.runFork(
      Effect.sleep(options.ttl).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (parked.get(threadId) !== entry) return Effect.void;
            parked.delete(threadId);
            return entry.launch.release;
          }),
        ),
      ),
    );
  };

  const insert = (threadId: ThreadId, launch: L) => {
    const entry = { launch };
    parked.delete(threadId);
    parked.set(threadId, entry);
    scheduleExpiry(threadId, entry);
  };

  const discard = (threadId: ThreadId): Effect.Effect<void> =>
    Effect.suspend(() => {
      const entry = parked.get(threadId);
      if (entry === undefined) return Effect.void;
      parked.delete(threadId);
      return entry.launch.release;
    });

  /** Hands over the thread's launch when it was started from `key`, else releases it. */
  const take = (threadId: ThreadId, key: string): Effect.Effect<L | undefined> =>
    Effect.suspend(() => {
      const entry = parked.get(threadId);
      if (entry === undefined) return Effect.succeed(undefined);
      parked.delete(threadId);
      if (entry.launch.key === key) return Effect.succeed(entry.launch);
      return entry.launch.release.pipe(Effect.as(undefined));
    });

  /** Extends the life of a matching launch; false when the thread has none for `key`. */
  const refresh = (threadId: ThreadId, key: string): boolean => {
    const entry = parked.get(threadId);
    if (entry?.launch.key !== key) return false;
    insert(threadId, entry.launch);
    return true;
  };

  const park = (threadId: ThreadId, launch: L): Effect.Effect<void> =>
    Effect.suspend(() => {
      insert(threadId, launch);
      const evicted: Array<ParkedEntry<L>> = [];
      for (const [parkedThreadId, entry] of parked) {
        if (parked.size <= options.capacity) break;
        parked.delete(parkedThreadId);
        evicted.push(entry);
      }
      return Effect.forEach(evicted, (entry) => entry.launch.release, { discard: true });
    });

  const discardAll: Effect.Effect<void> = Effect.suspend(() => {
    const entries = [...parked.values()];
    parked.clear();
    return Effect.forEach(entries, (entry) => entry.launch.release, {
      concurrency: "unbounded",
      discard: true,
    });
  });

  return { take, refresh, park, discard, discardAll };
}
