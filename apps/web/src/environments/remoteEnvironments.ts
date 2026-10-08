import type { DesktopSshConnectionState, DesktopSshHost } from "@glade/contracts/ipc/sshHosts";
import { useSyncExternalStore } from "react";
import type { StoreApi } from "zustand";
import { createAppStore, type AppStore } from "../appStore";
import { REMOTE_STORE_SIDE_EFFECTS } from "../storeSideEffects";
import { initialState } from "../storeState";
import { createEnvironmentNativeApi, type EnvironmentNativeApi } from "../wsNativeApi";
import { setEnvironmentWsUrl } from "./environmentEndpoints";
import { sshEnvironmentKey, type EnvironmentKey } from "./environmentKey";
import { registerEnvironmentStore, unregisterEnvironmentStore } from "./environmentStores";

export interface RemoteEnvironment {
  readonly key: EnvironmentKey;
  readonly host: DesktopSshHost;
  readonly connection: DesktopSshConnectionState | null;
  // Present while the host's server is reachable through its tunnel.
  readonly api: EnvironmentNativeApi | null;
  readonly store: StoreApi<AppStore>;
  readonly workspacePaths: { readonly homeDir: string; readonly chatWorkspaceRoot: string } | null;
  // The host's server speaks a protocol this app does not. The desktop never downgrades a host, so
  // the host runs a newer Glade than this app.
  readonly incompatible: boolean;
}

interface Entry {
  host: DesktopSshHost;
  connection: DesktopSshConnectionState | null;
  api: { readonly url: string; readonly value: EnvironmentNativeApi; stop: () => void } | null;
  readonly store: StoreApi<AppStore>;
  workspacePaths: RemoteEnvironment["workspacePaths"];
  incompatible: boolean;
}

// Every saved SSH host is an environment of this window, connected or not. A host's store keeps its
// last projects and threads while it is offline, so the sidebar can still show them.
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<RemoteEnvironment> = [];
let started = false;

function publish(): void {
  snapshot = [...entries.values()].map((entry) => ({
    key: sshEnvironmentKey(entry.host.id),
    host: entry.host,
    connection: entry.connection,
    api: entry.api?.value ?? null,
    store: entry.store,
    workspacePaths: entry.workspacePaths,
    incompatible: entry.incompatible,
  }));
  for (const listener of listeners) listener();
}

function closeApi(entry: Entry): void {
  setEnvironmentWsUrl(sshEnvironmentKey(entry.host.id), null);
  entry.incompatible = false;
  if (!entry.api) return;
  entry.api.stop();
  void entry.api.value.dispose();
  entry.api = null;
}

// A new address means the host's server was replaced and hands out a new token; the old transport
// can never reconnect, so it is dropped rather than left retrying.
function syncApi(entry: Entry): void {
  const url = entry.connection?.wsUrl ?? null;
  if (entry.api?.url === url) return;
  const replaced = entry.api !== null && url !== null;
  closeApi(entry);
  if (url === null) return;
  // A replaced server may start a new sequence space, which the store's stale-snapshot fence would
  // otherwise reject; start its projection over.
  if (replaced) entry.store.setState(initialState);
  const value = createEnvironmentNativeApi(url);
  const stop = value.onWelcome((payload) => {
    if (payload.homeDir === undefined || payload.chatWorkspaceRoot === undefined) return;
    entry.workspacePaths = {
      homeDir: payload.homeDir,
      chatWorkspaceRoot: payload.chatWorkspaceRoot,
    };
    publish();
  });
  const stopCompatibility = value.transport.onCompatibilityIssue((issue) => {
    if (entry.incompatible === (issue !== null)) return;
    entry.incompatible = issue !== null;
    publish();
  });
  entry.api = {
    url,
    value,
    stop: () => {
      stop();
      stopCompatibility();
    },
  };
  setEnvironmentWsUrl(sshEnvironmentKey(entry.host.id), url);
}

function applyHosts(hosts: ReadonlyArray<DesktopSshHost>): void {
  const savedIds = new Set(hosts.map((host) => host.id));
  for (const [hostId, entry] of entries) {
    if (savedIds.has(hostId)) continue;
    closeApi(entry);
    entries.delete(hostId);
    unregisterEnvironmentStore(sshEnvironmentKey(hostId));
  }
  for (const host of hosts) {
    const existing = entries.get(host.id);
    if (existing) {
      existing.host = host;
      continue;
    }
    const store = createAppStore({
      environmentKey: sshEnvironmentKey(host.id),
      initialState,
      effects: REMOTE_STORE_SIDE_EFFECTS,
      onProjectUiStateChanged: () => undefined,
    });
    entries.set(host.id, {
      host,
      connection: null,
      api: null,
      store,
      workspacePaths: null,
      incompatible: false,
    });
    registerEnvironmentStore(sshEnvironmentKey(host.id), store);
  }
}

function applyStates(states: ReadonlyArray<DesktopSshConnectionState>): void {
  for (const [hostId, entry] of entries) {
    entry.connection = states.find((state) => state.hostId === hostId) ?? null;
    syncApi(entry);
  }
  publish();
}

async function refreshHosts(): Promise<void> {
  const api = window.desktopBridge?.sshHosts;
  if (!api) return;
  applyHosts(await api.list());
  applyStates(await api.getStates());
}

// Loads saved hosts and connects them, so their projects appear without a visit to settings.
export function startRemoteEnvironments(): void {
  const api = window.desktopBridge?.sshHosts;
  if (started || !api) return;
  started = true;
  api.onStates(applyStates);
  void refreshHosts().then(() => {
    // Nobody asked for these connections, so they never open a password or host key prompt.
    for (const hostId of entries.keys()) {
      void api.connect(hostId, { interactive: false }).catch(() => undefined);
    }
  });
}

export async function saveRemoteHost(
  input: Parameters<NonNullable<NonNullable<Window["desktopBridge"]>["sshHosts"]>["save"]>[0],
): Promise<DesktopSshHost> {
  const api = window.desktopBridge?.sshHosts;
  if (!api) throw new Error("SSH hosts are available in the Glade desktop app.");
  const host = await api.save(input);
  await refreshHosts();
  return host;
}

export async function removeRemoteHost(hostId: string): Promise<void> {
  await window.desktopBridge?.sshHosts?.remove(hostId);
  await refreshHosts();
}

// The user asked for this connection, so ssh may ask them for a password or to trust a host key.
// Resolves once the host's server answers through its tunnel; progress arrives as state updates.
export async function connectRemoteHost(hostId: string): Promise<void> {
  await window.desktopBridge?.sshHosts?.connect(hostId, { interactive: true });
}

// The user's reconnect from settings: starts the connection over, accepts the machine the host
// reaches now and reinstalls Glade there when it is missing.
export async function repairRemoteHost(hostId: string): Promise<void> {
  await window.desktopBridge?.sshHosts?.connect(hostId, { interactive: true, repair: true });
}

export function remoteEnvironments(): ReadonlyArray<RemoteEnvironment> {
  return snapshot;
}

export function remoteEnvironment(key: EnvironmentKey): RemoteEnvironment | null {
  return snapshot.find((environment) => environment.key === key) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRemoteEnvironments(): ReadonlyArray<RemoteEnvironment> {
  return useSyncExternalStore(subscribe, remoteEnvironments);
}

// True once no saved host can still deliver threads soon: each is hydrated, failed or not connecting.
// Routes that cannot find their thread wait for this before giving up on it.
export function remoteEnvironmentsSettled(): boolean {
  return snapshot.every((environment) => {
    const phase = environment.connection?.phase;
    if (phase === undefined || phase === "failed") return true;
    return environment.store.getState().threadsHydrated;
  });
}
