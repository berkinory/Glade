import type { AcpConnection } from "./acpConnection.ts";

export interface AcpConnectionLease {
  readonly connection: AcpConnection;
  readonly release: () => Promise<void>;
}

interface PoolEntry {
  readonly connection: Promise<AcpConnection>;
  ready?: AcpConnection;
  leases: number;
}

export function makeAcpConnectionPool() {
  const entries = new Map<string, Set<PoolEntry>>();
  const forget = (key: string, entry: PoolEntry) => {
    const group = entries.get(key);
    group?.delete(entry);
    if (group?.size === 0) entries.delete(key);
  };

  const lease = async (key: string, open: () => Promise<AcpConnection>) => {
    // Without native session close, stopping one chat requires process-tree teardown.
    let entry = [...(entries.get(key) ?? [])].find(
      (candidate) =>
        candidate.leases < 2 &&
        candidate.ready?.isAvailable() &&
        candidate.ready?.initialize.agentCapabilities?.sessionCapabilities?.close,
    );
    if (!entry) {
      for (const previous of entries.get(key) ?? []) {
        if (previous.ready && !previous.ready.isAvailable()) await previous.ready.close();
      }
      const created: PoolEntry = { connection: open(), leases: 0 };
      let group = entries.get(key);
      if (!group) entries.set(key, (group = new Set()));
      group.add(created);
      created.connection.then(
        (connection) => {
          created.ready = connection;
          connection.onExit(() => forget(key, created));
        },
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
        if (!released) {
          released = true;
          leased.leases -= 1;
        }
        if (leased.leases > 0) return;
        await connection.close();
        forget(key, leased);
      },
    } satisfies AcpConnectionLease;
  };

  return { lease };
}
