interface CachedDiscovery<A> {
  readonly promise: Promise<A>;
  settledAt: number | null;
  failed: boolean;
}

export interface DiscoveryResultCache<A> {
  // Concurrent lookups for one key share a single discovery; `forceReload` always starts a new one.
  readonly lookup: (
    key: string,
    discover: () => Promise<A>,
    options?: { readonly forceReload?: boolean },
  ) => Promise<A>;
}

export function makeDiscoveryResultCache<A>(options: {
  readonly successTtlMs: number;
  readonly failureTtlMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}): DiscoveryResultCache<A> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, CachedDiscovery<A>>();

  const isReusable = (entry: CachedDiscovery<A>, at: number): boolean =>
    entry.settledAt === null ||
    at - entry.settledAt < (entry.failed ? options.failureTtlMs : options.successTtlMs);

  return {
    lookup: (key, discover, lookupOptions) => {
      const at = now();
      const existing = entries.get(key);
      if (existing && !lookupOptions?.forceReload && isReusable(existing, at)) {
        return existing.promise;
      }

      const entry: CachedDiscovery<A> = {
        promise: Promise.resolve().then(discover),
        settledAt: null,
        failed: false,
      };
      const settle = (failed: boolean) => {
        entry.settledAt = now();
        entry.failed = failed;
      };
      entry.promise.then(
        () => settle(false),
        () => settle(true),
      );
      entries.delete(key);
      entries.set(key, entry);
      for (const [otherKey, other] of entries) {
        if (entries.size <= options.maxEntries) break;
        if (other.settledAt !== null) entries.delete(otherKey);
      }
      return entry.promise;
    },
  };
}
