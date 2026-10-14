import type { NewSessionResponse } from "@agentclientprotocol/sdk";
import type { AcpConnection } from "./acpConnection.ts";
import type { AcpConnectionLease } from "./acpConnectionPool.ts";
import { closeAcpSession } from "./acpSessionShutdown";

export async function withEphemeralAcpSession<A>(input: {
  readonly lease: () => Promise<AcpConnectionLease>;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly use: (connection: AcpConnection, session: NewSessionResponse) => Promise<A>;
}): Promise<A> {
  const { connection, release } = await input.lease();
  let sessionId: string | undefined;
  let rejectAbort: (cause: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  // Cancellation may precede the first race; retain its rejection until cleanup is attached.
  void aborted.catch(() => undefined);
  const abort = () => rejectAbort(new Error("Auxiliary agent request cancelled."));
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    input.signal.throwIfAborted();
    const session = await Promise.race([
      connection.agent.newSession({ cwd: input.cwd, mcpServers: [] }),
      aborted,
    ]);
    sessionId = session.sessionId;
    input.signal.throwIfAborted();
    return await Promise.race([input.use(connection, session), aborted]);
  } finally {
    input.signal.removeEventListener("abort", abort);
    // The request may have created a session without returning its id. Auxiliary processes
    // never host chats, so closing that process is the only safe cleanup in that case.
    try {
      if (sessionId) await closeAcpSession(connection, sessionId, true);
      else await connection.close();
    } finally {
      await release();
    }
  }
}
