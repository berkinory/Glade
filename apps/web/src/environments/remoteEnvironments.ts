import type { DesktopPairedMachine } from "@glade/contracts/ipc/pairedMachines";
import type { DesktopSshConnectionState, DesktopSshHost } from "@glade/contracts/ipc/sshHosts";
import { useSyncExternalStore } from "react";
import type { StoreApi } from "zustand";
import { createAppStore, type AppStore } from "../appStore";
import { toastManager } from "../components/ui/toast";
import { ipcErrorMessage } from "../lib/ipcErrorMessage";
import { REMOTE_STORE_SIDE_EFFECTS } from "../storeSideEffects";
import { initialState } from "../storeState";
import { createEnvironmentNativeApi, type EnvironmentNativeApi } from "../wsNativeApi";
import { setEnvironmentWsUrl } from "./environmentEndpoints";
import { pairedEnvironmentKey, sshEnvironmentKey, type EnvironmentKey } from "./environmentKey";
import { registerEnvironmentStore, unregisterEnvironmentStore } from "./environmentStores";

// A machine this window reaches: a saved SSH host, or another machine's Glade paired with this app.
export type RemoteMachine =
  | { readonly kind: "ssh"; readonly host: DesktopSshHost }
  | { readonly kind: "paired"; readonly host: DesktopPairedMachine };

export type RemoteEnvironment = RemoteMachine & {
  readonly key: EnvironmentKey;
  readonly connection: DesktopSshConnectionState | null;
  // Present while the host's server is reachable through its tunnel.
  readonly api: EnvironmentNativeApi | null;
  readonly store: StoreApi<AppStore>;
  readonly workspacePaths: { readonly homeDir: string; readonly chatWorkspaceRoot: string } | null;
  // The host's server speaks a protocol this app does not. The desktop never downgrades a host, so
  // the host runs a newer Glade than this app.
  readonly incompatible: boolean;
};

interface Entry {
  readonly key: EnvironmentKey;
  machine: RemoteMachine;
  connection: DesktopSshConnectionState | null;
  api: { readonly url: string; readonly value: EnvironmentNativeApi; stop: () => void } | null;
  readonly store: StoreApi<AppStore>;
  workspacePaths: RemoteEnvironment["workspacePaths"];
  incompatible: boolean;
}

// Every saved SSH host and paired machine is an environment of this window, connected or not. Its
// store keeps the last projects and threads while it is offline, so the sidebar can still show them.
const entries = new Map<EnvironmentKey, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<RemoteEnvironment> = [];
let started = false;

function publish(): void {
  snapshot = [...entries.values()].map((entry) => ({
    ...entry.machine,
    key: entry.key,
    connection: entry.connection,
    api: entry.api?.value ?? null,
    store: entry.store,
    workspacePaths: entry.workspacePaths,
    incompatible: entry.incompatible,
  }));
  for (const listener of listeners) listener();
}

function closeApi(entry: Entry): void {
  setEnvironmentWsUrl(entry.key, null);
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
  setEnvironmentWsUrl(entry.key, url);
}

function keyOf(machine: RemoteMachine): EnvironmentKey {
  return machine.kind === "ssh"
    ? sshEnvironmentKey(machine.host.id)
    : pairedEnvironmentKey(machine.host.id);
}

function applyMachines(kind: RemoteMachine["kind"], machines: ReadonlyArray<RemoteMachine>): void {
  const savedKeys = new Set(machines.map(keyOf));
  for (const [key, entry] of entries) {
    if (entry.machine.kind !== kind || savedKeys.has(key)) continue;
    closeApi(entry);
    entries.delete(key);
    unregisterEnvironmentStore(key);
  }
  for (const machine of machines) {
    const key = keyOf(machine);
    const existing = entries.get(key);
    if (existing) {
      existing.machine = machine;
      continue;
    }
    const store = createAppStore({
      environmentKey: key,
      initialState,
      effects: REMOTE_STORE_SIDE_EFFECTS,
      onProjectUiStateChanged: () => undefined,
    });
    entries.set(key, {
      key,
      machine,
      connection: null,
      api: null,
      store,
      workspacePaths: null,
      incompatible: false,
    });
    registerEnvironmentStore(key, store);
  }
}

function applyStates(
  kind: RemoteMachine["kind"],
  states: ReadonlyArray<DesktopSshConnectionState>,
): void {
  for (const entry of entries.values()) {
    if (entry.machine.kind !== kind) continue;
    entry.connection = states.find((state) => state.hostId === entry.machine.host.id) ?? null;
    syncApi(entry);
  }
  publish();
}

async function refreshHosts(): Promise<void> {
  const api = window.desktopBridge?.sshHosts;
  if (!api) return;
  applyMachines(
    "ssh",
    (await api.list()).map((host) => ({ kind: "ssh", host })),
  );
  applyStates("ssh", await api.getStates());
}

async function refreshPairedMachines(): Promise<void> {
  const api = window.desktopBridge?.pairedMachines;
  if (!api) return;
  applyMachines(
    "paired",
    (await api.list()).map((host) => ({ kind: "paired", host })),
  );
  applyStates("paired", await api.getStates());
}

// Loads saved hosts and paired machines and connects them, so their projects appear without a visit
// to settings. The desktop connects paired machines on its own.
export function startRemoteEnvironments(): void {
  const api = window.desktopBridge?.sshHosts;
  if (started || !api) return;
  started = true;
  api.onStates((states) => applyStates("ssh", states));
  void refreshHosts().then(() => {
    // Nobody asked for these connections, so they never open a password or host key prompt.
    for (const entry of entries.values()) {
      if (entry.machine.kind !== "ssh") continue;
      void api.connect(entry.machine.host.id, { interactive: false }).catch(() => undefined);
    }
  });
  const paired = window.desktopBridge?.pairedMachines;
  if (!paired) return;
  // Machines can be added or removed from another window, so every update rereads the list.
  paired.onStates(() => void refreshPairedMachines().catch(() => undefined));
  void refreshPairedMachines().catch((error: unknown) =>
    toastManager.add({
      type: "error",
      title: "Could not load paired machines",
      description: ipcErrorMessage(error, "Try restarting Glade."),
    }),
  );
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

// Pairs this app with another machine's Glade from a pairing link made in its Remote access settings.
export async function addPairedMachine(link: string): Promise<DesktopPairedMachine> {
  const api = window.desktopBridge?.pairedMachines;
  if (!api) throw new Error("Pairing with another machine is available in the Glade desktop app.");
  const machine = await api.add(link);
  await refreshPairedMachines();
  return machine;
}

export async function removePairedMachine(machineId: string): Promise<void> {
  await window.desktopBridge?.pairedMachines?.remove(machineId);
  await refreshPairedMachines();
}

// The user picked this machine or asked to retry it. An SSH host may ask for a password or a host key.
export async function connectRemoteEnvironment(environment: RemoteMachine): Promise<void> {
  if (environment.kind === "ssh") {
    await connectRemoteHost(environment.host.id);
    return;
  }
  await window.desktopBridge?.pairedMachines?.connect(environment.host.id);
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
