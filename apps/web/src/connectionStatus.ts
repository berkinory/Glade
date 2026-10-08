import type { ServerRuntimeStatus } from "@glade/contracts/server/runtimeStatus";

// Transport-observed evidence for the connection notice. It explains delays; it never reconnects,
// retries a request or resends a mutation.
export interface ConnectionStatusSnapshot {
  readonly serverUnresponsive: boolean;
  readonly slowRequests: number;
  // Set briefly after the server answers again and reports an event-loop stall that explains it.
  readonly recoveredStallMs: number | null;
  readonly shellStreamPaused: boolean;
}

const EMPTY: ConnectionStatusSnapshot = {
  serverUnresponsive: false,
  slowRequests: 0,
  recoveredStallMs: null,
  shellStreamPaused: false,
};

const SLOW_REQUEST_MS = 15_000;
const SLOW_UNBOUNDED_REQUEST_MS = 120_000;
const MAX_TRACKED_REQUESTS = 256;
const RECOVERED_NOTICE_MS = 6_000;
// A reported stall older than the unresponsive episode plus this slack belongs to something else.
const STALL_ATTRIBUTION_SLACK_MS = 5_000;

let latest = EMPTY;
const listeners = new Set<() => void>();

export function getConnectionStatus(): ConnectionStatusSnapshot {
  return latest;
}

export function subscribeConnectionStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The local server's status, which the composer notice reads. SSH hosts report through their own
// transport so a slow host never reads as this machine being unresponsive.
export function publishConnectionStatus(snapshot: ConnectionStatusSnapshot): void {
  latest = snapshot;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A UI observer must not fail transport bookkeeping.
    }
  }
}

function slowAfterMs(timeoutMs: number | null | undefined): number {
  if (timeoutMs === null) return SLOW_UNBOUNDED_REQUEST_MS;
  return timeoutMs !== undefined && timeoutMs > 60_000 ? timeoutMs * 0.75 : SLOW_REQUEST_MS;
}

export class ConnectionStatusTracker {
  private snapshot = EMPTY;
  private readonly pending = new Map<
    symbol,
    { slow: boolean; timer: ReturnType<typeof setTimeout> }
  >();
  private unresponsiveSince: number | null = null;
  private recoveredTimer: ReturnType<typeof setTimeout> | undefined;
  private episode = 0;
  private disposed = false;

  constructor(
    private readonly readRuntimeStatus: () => Promise<ServerRuntimeStatus> | null,
    private readonly onChange: (snapshot: ConnectionStatusSnapshot) => void,
  ) {}

  current(): ConnectionStatusSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<ConnectionStatusSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (
      next.serverUnresponsive === this.snapshot.serverUnresponsive &&
      next.slowRequests === this.snapshot.slowRequests &&
      next.recoveredStallMs === this.snapshot.recoveredStallMs &&
      next.shellStreamPaused === this.snapshot.shellStreamPaused
    )
      return;
    this.snapshot = next;
    if (!this.disposed) this.onChange(next);
  }

  trackRequest(timeoutMs: number | null | undefined): () => void {
    if (this.disposed || this.pending.size >= MAX_TRACKED_REQUESTS) return () => undefined;
    const token = Symbol();
    const timer = globalThis.setTimeout(() => {
      const entry = this.pending.get(token);
      if (!entry) return;
      entry.slow = true;
      this.update({ slowRequests: this.snapshot.slowRequests + 1 });
    }, slowAfterMs(timeoutMs));
    this.pending.set(token, { slow: false, timer });
    return () => {
      const entry = this.pending.get(token);
      if (!entry) return;
      globalThis.clearTimeout(entry.timer);
      this.pending.delete(token);
      if (entry.slow) this.update({ slowRequests: this.snapshot.slowRequests - 1 });
    };
  }

  setServerResponsive(responsive: boolean): void {
    if (this.disposed || responsive === !this.snapshot.serverUnresponsive) return;
    this.episode += 1;
    globalThis.clearTimeout(this.recoveredTimer);
    if (!responsive) {
      this.unresponsiveSince = performance.now();
      this.update({ serverUnresponsive: true, recoveredStallMs: null });
      return;
    }
    const episodeMs =
      this.unresponsiveSince === null ? 0 : performance.now() - this.unresponsiveSince;
    this.unresponsiveSince = null;
    this.update({ serverUnresponsive: false });
    const episode = this.episode;
    void this.readRuntimeStatus()
      ?.then((status) => {
        const stall = status.lastStall;
        if (episode !== this.episode || this.disposed || !status.available || stall === null)
          return;
        if (stall.ageMs > episodeMs + STALL_ATTRIBUTION_SLACK_MS) return;
        this.update({ recoveredStallMs: stall.durationMs });
        this.recoveredTimer = globalThis.setTimeout(() => {
          if (episode === this.episode) this.update({ recoveredStallMs: null });
        }, RECOVERED_NOTICE_MS);
      })
      .catch(() => undefined);
  }

  // A replaced or closed connection resets liveness evidence; the reconnect notice takes over.
  resetLiveness(): void {
    this.episode += 1;
    this.unresponsiveSince = null;
    globalThis.clearTimeout(this.recoveredTimer);
    this.update({ serverUnresponsive: false, recoveredStallMs: null });
  }

  setShellStreamPaused(paused: boolean): void {
    this.update({ shellStreamPaused: paused });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.pending.values()) globalThis.clearTimeout(entry.timer);
    this.pending.clear();
    globalThis.clearTimeout(this.recoveredTimer);
    this.onChange(EMPTY);
    this.disposed = true;
  }
}
