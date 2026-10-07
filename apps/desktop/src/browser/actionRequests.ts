import type { CdpSession } from "./cdp/cdpSession";

// Long-lived or speculative requests never finish on an action's time scale.
const UNTRACKED_TYPES = new Set(["WebSocket", "EventSource", "Media", "Prefetch", "Ping"]);

// The requests an input action itself starts: those sent from the action's start until shortly
// after it ends. Only these are waited for, never the page's other traffic, because the user shares
// the browser and a busy page would otherwise stall every action.
export class ActionRequests {
  private readonly pending = new Set<string>();
  private open = true;
  private onDone: (() => void) | null = null;
  private readonly stopListening: () => void;

  constructor(cdp: CdpSession) {
    this.stopListening = cdp.on((method, params, sessionId) => {
      const key = `${sessionId ?? ""}:${params?.requestId}`;
      if (method === "Network.requestWillBeSent") {
        if (this.open && !UNTRACKED_TYPES.has(params.type)) this.pending.add(key);
      } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
        if (this.pending.delete(key) && this.pending.size === 0) this.onDone?.();
      }
    });
  }

  // Requests sent from now on belong to someone else.
  close(): void {
    this.open = false;
  }

  // Resolves once every tracked request finished, or after `capMs`.
  async settle(capMs: number): Promise<void> {
    this.close();
    if (this.pending.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    await new Promise<void>((resolve) => {
      this.onDone = resolve;
      timer = setTimeout(resolve, capMs);
    });
    clearTimeout(timer);
    this.onDone = null;
  }

  stop(): void {
    this.stopListening();
    this.onDone?.();
  }
}
