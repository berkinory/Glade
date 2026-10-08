import type { DesktopSshConnectionState } from "@glade/contracts/ipc/sshHosts";
import { createRemoteConnection, type RemoteConnection } from "./remoteConnection";
import type { RemoteServerBundleSource } from "./remoteServerBundle";
import type { SshAskpass } from "./sshAskpass";
import type { SshHostsStore } from "./sshHostsStore";

interface RemoteConnectionsOptions {
  readonly store: SshHostsStore;
  readonly bundles: RemoteServerBundleSource;
  readonly version: string;
  readonly devUrl: string | null;
  readonly askpass: SshAskpass;
  readonly publish: (states: ReadonlyArray<DesktopSshConnectionState>) => void;
  readonly log: (message: string) => void;
}

// A host that could not be reached (offline, asleep, network down) is tried again in the background,
// so the sidebar and pickers show it as soon as it answers. Failures that need the user (a changed
// machine, a password or host key) wait for them instead.
const BACKGROUND_RETRY_MS = 45_000;

interface OpenConnection {
  readonly connection: RemoteConnection;
  starting: Promise<void> | null;
}

// Owns one connection per SSH host the renderer asked for. Connections outlive windows: they end
// when the renderer disconnects the host, the host is removed, or the app quits.
export interface RemoteConnections {
  connect(
    hostId: string,
    options: { readonly interactive: boolean; readonly repair?: boolean },
  ): Promise<void>;
  states(): ReadonlyArray<DesktopSshConnectionState>;
  forget(hostId: string): void;
  wakeAll(): void;
  stopAll(): void;
}

export function createRemoteConnections(options: RemoteConnectionsOptions): RemoteConnections {
  const open = new Map<string, OpenConnection>();
  const failures = new Map<string, DesktopSshConnectionState>();
  const retryTimers = new Map<string, NodeJS.Timeout>();

  function cancelRetry(hostId: string): void {
    const timer = retryTimers.get(hostId);
    if (timer) clearTimeout(timer);
    retryTimers.delete(hostId);
  }

  function recordFailure(hostId: string, state: DesktopSshConnectionState): void {
    failures.set(hostId, state);
    cancelRetry(hostId);
    if (state.issue !== null) return;
    retryTimers.set(
      hostId,
      setTimeout(() => {
        retryTimers.delete(hostId);
        if (open.has(hostId) || !failures.has(hostId)) return;
        void connections.connect(hostId, { interactive: false }).catch(() => undefined);
      }, BACKGROUND_RETRY_MS),
    );
  }

  function states(): DesktopSshConnectionState[] {
    return [
      ...[...open.values()].map((entry) => entry.connection.state()),
      ...[...failures.values()].filter((state) => !open.has(state.hostId)),
    ];
  }

  const publish = () => options.publish(states());

  function close(hostId: string): void {
    const entry = open.get(hostId);
    if (!entry) return;
    entry.connection.stop();
    open.delete(hostId);
    publish();
  }

  const connections: RemoteConnections = {
    async connect(hostId, { interactive, repair }) {
      // A repair starts over even from a live connection; the install step then restores a missing or
      // reset Glade on the host.
      if (repair) {
        close(hostId);
        options.store.forgetMachine(hostId);
      }
      const existing = open.get(hostId);
      if (existing) return existing.starting ?? undefined;

      const host = options.store.get(hostId);
      if (!host) throw new Error("That SSH host no longer exists.");
      failures.delete(hostId);
      cancelRetry(hostId);
      const entry: OpenConnection = {
        starting: null,
        connection: createRemoteConnection({
          host,
          version: options.version,
          bundles: options.bundles,
          devUrl: options.devUrl,
          askpass: options.askpass,
          knownMachine: () => options.store.machineOf(hostId),
          rememberMachine: (machineId) => options.store.rememberMachine(hostId, machineId),
          onState: publish,
          onGaveUp: () => {
            recordFailure(hostId, entry.connection.state());
            if (open.get(hostId) === entry) close(hostId);
          },
          log: options.log,
        }),
      };
      open.set(hostId, entry);
      entry.starting = entry.connection
        .start({ interactive })
        .catch((error: unknown) => {
          recordFailure(hostId, entry.connection.state());
          if (open.get(hostId) === entry) close(hostId);
          throw error;
        })
        .finally(() => {
          entry.starting = null;
        });
      return entry.starting;
    },
    states,
    forget(hostId) {
      close(hostId);
      cancelRetry(hostId);
      failures.delete(hostId);
      publish();
    },
    wakeAll() {
      for (const entry of open.values()) entry.connection.wake();
      // A wake usually means the network is back, so waiting hosts are tried now.
      for (const [hostId, state] of failures) {
        if (state.issue !== null || !retryTimers.has(hostId)) continue;
        cancelRetry(hostId);
        void connections.connect(hostId, { interactive: false }).catch(() => undefined);
      }
    },
    stopAll() {
      for (const hostId of [...retryTimers.keys()]) cancelRetry(hostId);
      for (const hostId of [...open.keys()]) close(hostId);
    },
  };
  return connections;
}
