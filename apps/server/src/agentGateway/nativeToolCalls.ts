/** Provider-owned tool ids connect MCP traffic to the turn that issued it. */
export interface NativeToolCall {
  readonly callId: string;
  readonly turnId: string;
  readonly toolName: string;
}

export function makeNativeToolCallRegistry() {
  const sessions = new Map<
    string,
    {
      calls: Map<string, NativeToolCall>;
      retiredTurns: Set<string>;
      pending: Set<() => void>;
    }
  >();
  return {
    enable(token: string) {
      sessions.set(token, { calls: new Map(), retiredTurns: new Set(), pending: new Set() });
    },
    has: (token: string) => sessions.has(token),
    isRetired: (token: string, turnId: string) =>
      sessions.get(token)?.retiredTurns.has(turnId) === true,
    register(token: string, call: NativeToolCall) {
      const session = sessions.get(token);
      if (!session || session.retiredTurns.has(call.turnId)) return;
      // A provider call id may never be reassigned to a later turn.
      if (!session.calls.has(call.callId)) session.calls.set(call.callId, call);
      for (const wake of session.pending) wake();
    },
    async resolve(
      token: string,
      callId: string,
      toolName: string,
      signal?: AbortSignal,
    ): Promise<string | null> {
      const session = sessions.get(token);
      if (!session || signal?.aborted) return null;
      // Stdio and HTTP are independent transports: HTTP may arrive before the
      // already-emitted native item event. Wait briefly for proof, never guess B.
      if (!session.calls.has(callId)) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            session.pending.delete(wake);
            signal?.removeEventListener("abort", finish);
            resolve();
          };
          const wake = () => {
            if (session.calls.has(callId) || sessions.get(token) !== session) finish();
          };
          const timer = setTimeout(finish, 2_000);
          session.pending.add(wake);
          signal?.addEventListener("abort", finish, { once: true });
        });
      }
      if (sessions.get(token) !== session || signal?.aborted) return null;
      const call = session.calls.get(callId);
      return call && call.toolName === toolName && !session.retiredTurns.has(call.turnId)
        ? call.turnId
        : null;
    },
    retire(token: string, turnId: string) {
      const session = sessions.get(token);
      if (!session) return;
      session.retiredTurns.add(turnId);
      for (const [id, call] of session.calls) {
        if (call.turnId === turnId) session.calls.delete(id);
      }
    },
    revoke(token: string) {
      const session = sessions.get(token);
      sessions.delete(token);
      if (session) for (const wake of session.pending) wake();
    },
  };
}

export type NativeToolCallRegistry = ReturnType<typeof makeNativeToolCallRegistry>;

export function nativeMcpCallId(provider: string, params: Record<string, unknown>): string | null {
  const meta = params._meta;
  if (typeof meta !== "object" || meta === null) return null;
  const key =
    provider === "codex" ? "callId" : provider === "claudeAgent" ? "claudecode/toolUseId" : null;
  if (key === null) return null;
  const id = (meta as Record<string, unknown>)[key];
  return typeof id === "string" && id.length > 0 ? id : null;
}
