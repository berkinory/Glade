import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { NewSessionResponse } from "@agentclientprotocol/sdk";

import type { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import { openAcpConnection, type AcpConnection } from "./acpConnection.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";

// A private agent process with one session that leaves nothing behind: the session is removed from
// the agent's own history and the process tree is torn down, including when `signal` aborts.
export async function withEphemeralAcpSession<A>(input: {
  readonly profile: AcpProviderProfile;
  readonly child: ChildProcessWithoutNullStreams;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly teardownProcessTree?: Parameters<typeof teardownChildProcessTree>[1];
  readonly use: (connection: AcpConnection, session: NewSessionResponse) => Promise<A>;
}): Promise<A> {
  const connection = await openAcpConnection({
    child: input.child,
    profile: input.profile,
    ...(input.teardownProcessTree ? { teardownProcessTree: input.teardownProcessTree } : {}),
  });
  const abort = () => void connection.close();
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    input.signal.throwIfAborted();
    const session = await connection.agent.newSession({ cwd: input.cwd, mcpServers: [] });
    try {
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
    await connection.close();
  }
}
