import type {
  DesktopQuitConfirmationChat,
  DesktopQuitConfirmationRequest,
  DesktopQuitConfirmationResponse,
} from "@glade/contracts/ipc/ipc";

const DEFAULT_READY_TIMEOUT_MS = 3000;

export function shouldPromptForRunningChatsBeforeQuit(reason: string): boolean {
  return reason === "window-close" || reason === "before-quit";
}

export function parseQuitConfirmationRequest(
  payload: unknown,
): DesktopQuitConfirmationRequest | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const requestId = (payload as { readonly requestId?: unknown }).requestId;
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return null;
  }
  return { requestId, presentation: "in-app" };
}

function parseQuitConfirmationChats(value: unknown): DesktopQuitConfirmationChat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const chats: DesktopQuitConfirmationChat[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") {
      continue;
    }
    const id = (item as { readonly id?: unknown }).id;
    const title = (item as { readonly title?: unknown }).title;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }
    chats.push({
      id,
      title: typeof title === "string" ? title : "",
    });
  }
  return chats;
}

export function parseQuitConfirmationResponse(
  payload: unknown,
): DesktopQuitConfirmationResponse | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const record = payload as {
    readonly requestId?: unknown;
    readonly phase?: unknown;
    readonly runningCount?: unknown;
    readonly chats?: unknown;
    readonly allow?: unknown;
  };
  if (typeof record.requestId !== "string" || record.requestId.trim().length === 0) {
    return null;
  }
  if (record.phase === "ready") {
    if (typeof record.runningCount !== "number" || !Number.isFinite(record.runningCount)) {
      return null;
    }
    return {
      requestId: record.requestId,
      phase: "ready",
      runningCount: record.runningCount,
      chats: parseQuitConfirmationChats(record.chats),
    };
  }
  if (record.phase === "decision" && typeof record.allow === "boolean") {
    return {
      requestId: record.requestId,
      phase: "decision",
      allow: record.allow,
    };
  }
  return null;
}

export interface RunningChatsQuitGuard {
  readonly hasAllowedQuit: () => boolean;
  readonly cancelPending: () => void;
  // A renderer that died while hosting the ask can never answer it, and that is not proof that no
  // chats run. The pending ask moves to the native confirmation; the returned decision is shared
  // with every waiting quit request. Returns null when no ask was pending.
  readonly rendererGone: () => Promise<boolean> | null;
  readonly receiveResponse: (payload: unknown) => void;
  readonly askRenderer: (input: {
    readonly send: (request: DesktopQuitConfirmationRequest) => void;
    readonly isRendererAvailable: () => boolean;
    readonly confirmWithoutRenderer: () => Promise<boolean>;
    readonly readyTimeoutMs?: number;
  }) => Promise<boolean>;
}

interface PendingQuitConfirmation {
  readonly requestId: string;
  readonly confirmWithoutRenderer: () => Promise<boolean>;
  waitingForDecision: boolean;
  readyTimer: ReturnType<typeof setTimeout> | null;
  readonly resolve: (allow: boolean) => void;
}

export function makeRunningChatsQuitGuard(
  createRequestId: () => string = () => crypto.randomUUID(),
): RunningChatsQuitGuard {
  let allowed = false;
  let inFlight: Promise<boolean> | null = null;
  let pending: PendingQuitConfirmation | null = null;

  const takePending = (): PendingQuitConfirmation | null => {
    const current = pending;
    pending = null;
    if (current?.readyTimer) {
      clearTimeout(current.readyTimer);
    }
    return current;
  };

  const settle = (current: PendingQuitConfirmation | null, allow: boolean): void => {
    if (allow) {
      allowed = true;
    }
    current?.resolve(allow);
  };

  const finish = (allow: boolean): void => {
    settle(takePending(), allow);
  };

  // Cancelling or failing to show the native dialog never counts as permission to quit.
  const confirmNatively = (confirm: () => Promise<boolean>): Promise<boolean> =>
    Promise.resolve()
      .then(confirm)
      .catch(() => false);

  const fallBackToNativeConfirmation = (): void => {
    const current = takePending();
    if (!current) return;
    void confirmNatively(current.confirmWithoutRenderer).then((allow) => settle(current, allow));
  };

  return {
    hasAllowedQuit: () => allowed,
    cancelPending(): void {
      finish(false);
    },
    rendererGone(): Promise<boolean> | null {
      if (pending === null) return null;
      const decision = inFlight;
      fallBackToNativeConfirmation();
      return decision;
    },
    receiveResponse(payload: unknown): void {
      const response = parseQuitConfirmationResponse(payload);
      if (!response || pending == null || response.requestId !== pending.requestId) {
        return;
      }
      if (response.phase === "decision") {
        finish(response.allow);
        return;
      }
      if (pending.readyTimer) {
        clearTimeout(pending.readyTimer);
        pending.readyTimer = null;
      }
      if (response.runningCount <= 0) {
        finish(true);
        return;
      }
      pending.waitingForDecision = true;
    },
    askRenderer(input): Promise<boolean> {
      if (allowed) {
        return Promise.resolve(true);
      }
      if (inFlight) {
        return inFlight;
      }
      if (!input.isRendererAvailable()) {
        const decision = confirmNatively(input.confirmWithoutRenderer).then((allow) => {
          inFlight = null;
          settle(null, allow);
          return allow;
        });
        inFlight = decision;
        return decision;
      }

      inFlight = new Promise<boolean>((resolve) => {
        const requestId = createRequestId();
        pending = {
          requestId,
          confirmWithoutRenderer: input.confirmWithoutRenderer,
          waitingForDecision: false,
          readyTimer: setTimeout(() => {
            if (pending?.requestId === requestId && !pending.waitingForDecision) {
              fallBackToNativeConfirmation();
            }
          }, input.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS),
          resolve: (allow) => {
            inFlight = null;
            resolve(allow);
          },
        };
        try {
          input.send({ requestId, presentation: "in-app" });
        } catch {
          fallBackToNativeConfirmation();
        }
      });
      return inFlight;
    },
  };
}
