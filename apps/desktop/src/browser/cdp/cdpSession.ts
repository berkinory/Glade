import type { WebContents } from "electron";

export type CdpListener = (method: string, params: any, sessionId: string | undefined) => void;

interface ChildTarget {
  readonly targetId: string;
  readonly parentSessionId: string | undefined;
}

const PROTOCOL_VERSION = "1.3";
const DOMAINS = ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"] as const;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

// One debugger attachment per tab. Out-of-process iframes arrive through flattened auto-attach
// and are addressed by sessionId; same-process frames share the root session.
export class CdpSession {
  private readonly listeners = new Set<CdpListener>();
  private readonly children = new Map<string, ChildTarget>();
  private attaching: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly webContents: WebContents) {
    const debuggerApi = webContents.debugger;
    debuggerApi.on("message", (_event, method, params, sessionId) => {
      const session = sessionId || undefined;
      if (method === "Target.attachedToTarget") this.adoptChild(params, session);
      if (method === "Target.detachedFromTarget") this.children.delete(params.sessionId);
      for (const listener of this.listeners) listener(method, params, session);
    });
    // DevTools or a crashed renderer takes the debugger away; the next call reattaches.
    debuggerApi.on("detach", () => {
      this.children.clear();
      this.attaching = null;
      for (const listener of this.listeners) listener("Glade.detached", {}, undefined);
    });
  }

  ensureAttached(): Promise<void> {
    if (this.webContents.debugger.isAttached() && this.attaching) return this.attaching;
    this.attaching = (async () => {
      if (!this.webContents.debugger.isAttached()) {
        this.webContents.debugger.attach(PROTOCOL_VERSION);
      }
      await this.enable(undefined);
      // Without focus emulation an unfocused or detached view holds the first mouse event for the
      // 5 s input-ack timeout, and pages see document.hasFocus() as false.
      await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    })();
    this.attaching.catch(() => {
      this.attaching = null;
    });
    return this.attaching;
  }

  send<T = any>(method: string, params?: object, sessionId?: string): Promise<T> {
    return this.webContents.debugger.sendCommand(method, params, sessionId) as Promise<T>;
  }

  // Serializes whole tool operations on this tab; interleaved snapshot and input commands from
  // two calls would read half-updated trees.
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  on(listener: CdpListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sessionForFrame(frameId: string): string | undefined {
    for (const [sessionId, child] of this.children) {
      if (child.targetId === frameId) return sessionId;
    }
    return undefined;
  }

  childTarget(sessionId: string): ChildTarget | undefined {
    return this.children.get(sessionId);
  }

  detach(): void {
    if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach();
  }

  private adoptChild(params: any, parentSessionId: string | undefined): void {
    if (params.targetInfo?.type !== "iframe") return;
    this.children.set(params.sessionId, {
      targetId: params.targetInfo.targetId,
      parentSessionId,
    });
    void this.enable(params.sessionId).catch(() => undefined);
  }

  private async enable(sessionId: string | undefined): Promise<void> {
    await Promise.all([
      ...DOMAINS.map((method) => this.send(method, {}, sessionId)),
      this.send("Target.setAutoAttach", AUTO_ATTACH, sessionId),
    ]);
  }
}
