import type { AcpConnection } from "./acpConnection.ts";

interface AcpConnectionLease {
  readonly connection: AcpConnection;
  readonly release: () => Promise<void>;
}

interface PoolEntry {
  readonly connection: Promise<AcpConnection>;
  leases: number;
}

// Chats with the same executable and spawn environment share one agent process: ACP routes every
// update by session id, and a second session costs the agent a few megabytes instead of a process.
// The last lease closes the process; an exited process leaves the pool so the next lease respawns.
export function makeAcpConnectionPool() {
  const entries = new Map<string, PoolEntry>();
  const forget = (key: string, entry: PoolEntry) => {
    if (entries.get(key) === entry) entries.delete(key);
  };

  const lease = async (key: string, open: () => Promise<AcpConnection>) => {
    let entry = entries.get(key);
    if (!entry) {
      const created: PoolEntry = { connection: open(), leases: 0 };
      entries.set(key, created);
      created.connection.then(
        (connection) => connection.onExit(() => forget(key, created)),
        () => forget(key, created),
      );
      entry = created;
    }
    const leased = entry;
    leased.leases += 1;
    let connection: AcpConnection;
    try {
      connection = await leased.connection;
    } catch (cause) {
      leased.leases -= 1;
      throw cause;
    }
    let released = false;
    return {
      connection,
      release: async () => {
        if (released) return;
        released = true;
        leased.leases -= 1;
        if (leased.leases > 0) return;
        forget(key, leased);
        await connection.close();
      },
    } satisfies AcpConnectionLease;
  };

  return { lease };
}
