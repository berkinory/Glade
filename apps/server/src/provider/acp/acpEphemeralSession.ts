import type { NewSessionResponse } from "@agentclientprotocol/sdk";

import type { AcpConnection } from "./acpConnection.ts";
import type { AcpConnectionLease } from "./acpConnectionPool.ts";

// One session that leaves nothing behind: it is removed from the agent's own history afterwards.
// The agent process may serve chats too, so `signal` cancels this session's prompt instead of
// ending the process; the last lease still ends it.
export async function withEphemeralAcpSession<A>(input: {
  readonly lease: () => Promise<AcpConnectionLease>;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly use: (connection: AcpConnection, session: NewSessionResponse) => Promise<A>;
}): Promise<A> {
  const { connection, release } = await input.lease();
  let sessionId: string | undefined;
  const abort = () => {
    if (sessionId) void connection.agent.cancel({ sessionId }).catch(() => undefined);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    input.signal.throwIfAborted();
    const session = await connection.agent.newSession({ cwd: input.cwd, mcpServers: [] });
    sessionId = session.sessionId;
    try {
      input.signal.throwIfAborted();
      return await input.use(connection, session);
    } finally {
      const capabilities = connection.initialize.agentCapabilities?.sessionCapabilities;
      if (capabilities?.delete) {
        await connection.agent
          .deleteSession({ sessionId: session.sessionId })
          .catch(() => undefined);
      } else if (capabilities?.close) {
        await connection.agent
          .closeSession({ sessionId: session.sessionId })
          .catch(() => undefined);
      }
    }
  } finally {
    input.signal.removeEventListener("abort", abort);
    await release();
  }
}
