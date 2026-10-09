import { app, BrowserWindow, powerMonitor } from "electron";
import * as Path from "node:path";
import { GLADE_DESKTOP_ORIGIN } from "@glade/shared/platform/desktopIdentity";
import {
  DESKTOP_PAIRED_MACHINES_PATH,
  DESKTOP_SSH_HOSTS_PATH,
  isDevelopment,
  ROOT_DIR,
} from "../main/desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../main/ipc/ipcChannels";
import { createRemoteConnections, type RemoteConnections } from "./remoteConnections";
import { createRemoteServerBundleSource } from "./remoteServerBundle";
import { createSshAskpass, type SshAskpass } from "./sshAskpass";
import { createSshHostsStore, type SshHostsStore } from "./sshHostsStore";
import { createPairedMachines, type PairedMachines } from "./paired/pairedMachines";
import { createPairedMachinesStore } from "./paired/pairedMachinesStore";

interface RemoteHostsDependencies {
  readAppUpdateYml(): Record<string, string> | null;
  log(message: string): void;
}

function localBundleDirectory(): string | null {
  const configured = process.env.GLADE_REMOTE_SERVER_BUNDLE_DIR?.trim();
  if (configured) return Path.resolve(configured);
  return isDevelopment ? Path.join(ROOT_DIR, "release/remote") : null;
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

export function createRemoteHosts(dependencies: RemoteHostsDependencies): {
  readonly store: SshHostsStore;
  readonly connections: RemoteConnections;
  readonly askpass: SshAskpass;
  readonly pairedMachines: PairedMachines;
  stop(): void;
} {
  const store = createSshHostsStore(DESKTOP_SSH_HOSTS_PATH);
  const askpass = createSshAskpass({
    publish: (prompts) => sendToWindows(DESKTOP_IPC_CHANNELS.sshHostPrompts, prompts),
  });
  const updateConfig = dependencies.readAppUpdateYml();
  const devUrl = isDevelopment ? (process.env.VITE_DEV_SERVER_URL ?? null) : null;
  const connections = createRemoteConnections({
    store,
    version: app.getVersion(),
    // The development renderer is served by Vite; host servers must trust it as an origin.
    devUrl,
    bundles: createRemoteServerBundleSource({
      version: app.getVersion(),
      localDirectory: localBundleDirectory(),
      release:
        updateConfig?.owner && updateConfig.repo
          ? { owner: updateConfig.owner, repo: updateConfig.repo }
          : null,
    }),
    askpass,
    publish: (states) => sendToWindows(DESKTOP_IPC_CHANNELS.sshHostStates, states),
    log: dependencies.log,
  });
  const pairedMachines = createPairedMachines({
    store: createPairedMachinesStore(DESKTOP_PAIRED_MACHINES_PATH),
    // Only this app's own windows may read what a paired machine answers.
    allowedOrigins: new Set([GLADE_DESKTOP_ORIGIN, ...(devUrl ? [new URL(devUrl).origin] : [])]),
    otherServerUrls: () =>
      connections
        .states()
        .flatMap((state) => (state.wsUrl ? [state.wsUrl.replace(/^ws/u, "http")] : [])),
    publish: (states) => sendToWindows(DESKTOP_IPC_CHANNELS.pairedMachineStates, states),
    log: dependencies.log,
  });
  // Tunnels rarely survive sleep; waiting out the backoff would leave hosts offline after wake.
  void app.whenReady().then(() => {
    pairedMachines.connectAll();
    powerMonitor.on("resume", () => {
      connections.wakeAll();
      pairedMachines.connectAll();
    });
  });
  return {
    store,
    connections,
    askpass,
    pairedMachines,
    stop() {
      connections.stopAll();
      askpass.close();
      void pairedMachines.stop();
    },
  };
}
