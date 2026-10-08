import type { DesktopSshConnectionState } from "@glade/contracts/ipc/sshHosts";

export interface RemoteEnvironmentStatus {
  readonly label: string;
  readonly tone: "connected" | "busy" | "offline" | "error";
  // The host's server answers, possibly through a tunnel that is being re-established.
  readonly reachable: boolean;
}

function percentOf(progress: DesktopSshConnectionState["progress"]): string {
  return progress && progress.totalBytes > 0
    ? ` ${Math.floor((progress.doneBytes / progress.totalBytes) * 100)}%`
    : "";
}

// The one wording of a host's connection, shared by the sidebar, pickers and settings.
export function describeRemoteEnvironment(environment: {
  readonly connection: DesktopSshConnectionState | null;
  readonly incompatible: boolean;
}): RemoteEnvironmentStatus {
  const { connection } = environment;
  if (environment.incompatible) {
    return { label: "Needs a newer Glade", tone: "error", reachable: false };
  }
  if (!connection) return { label: "Not connected", tone: "offline", reachable: false };
  const percent = percentOf(connection.progress);
  switch (connection.phase) {
    case "connecting":
      return { label: "Connecting…", tone: "busy", reachable: false };
    case "downloading":
      return { label: `Downloading Glade${percent}`, tone: "busy", reachable: false };
    case "installing":
      return { label: `Installing Glade${percent}`, tone: "busy", reachable: false };
    case "starting":
      return { label: "Starting Glade…", tone: "busy", reachable: false };
    case "connected":
      return { label: "Connected", tone: "connected", reachable: true };
    case "reconnecting":
      return { label: "Reconnecting…", tone: "busy", reachable: true };
    case "failed":
      return { label: "Could not connect", tone: "error", reachable: false };
  }
}

export interface RemoteHostAvailability {
  readonly tone: "connected" | "busy" | "offline" | "attention";
  // A chat or project can be placed on the host: only while it is connected.
  readonly selectable: boolean;
  // The host waits for the user in Settings → SSH hosts: a changed machine, or a password or host key.
  readonly needsUser: boolean;
  readonly reason: string;
}

// Whether pickers offer a host. Only connected hosts are offered; unreachable ones are retried in the
// background, and ones that need the user point to the SSH settings, where Reconnect repairs them.
export function remoteHostAvailability(environment: {
  readonly connection: DesktopSshConnectionState | null;
  readonly incompatible: boolean;
}): RemoteHostAvailability {
  const status = describeRemoteEnvironment(environment);
  if (environment.connection?.issue) {
    return {
      tone: "attention",
      selectable: false,
      needsUser: true,
      reason: "Needs attention. Reconnect it from SSH settings.",
    };
  }
  if (environment.incompatible) {
    return { tone: "attention", selectable: false, needsUser: false, reason: status.label };
  }
  if (status.tone === "connected") {
    return { tone: "connected", selectable: true, needsUser: false, reason: status.label };
  }
  if (status.tone === "busy") {
    return { tone: "busy", selectable: false, needsUser: false, reason: status.label };
  }
  return {
    tone: "offline",
    selectable: false,
    needsUser: false,
    reason: `${environment.connection?.detail ?? "Not reachable."} Glade keeps trying.`,
  };
}
