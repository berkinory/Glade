import type { ServerLocalServerProcess } from "@glade/contracts/server/server";

import { isWorkspaceRootWithin } from "./threadWorkspace";

export interface LocalServerRunIdentity {
  readonly pid: number | null;
  readonly cwd: string;
}

export function localServerAddressLabel(server: ServerLocalServerProcess): string {
  const ports = server.ports.length > 0 ? server.ports : firstAddressPort(server);
  if (ports.length === 0) {
    return "localhost";
  }
  return ports.map((port) => `localhost:${port}`).join(", ");
}

// Primary human-facing label for a detected local dev server: the live page title when one was
// resolved, otherwise the detected tool/display name.
export function localServerPrimaryLabel(server: ServerLocalServerProcess): string {
  return server.pageTitle ?? server.displayName;
}

export function localServerFolderLabel(server: ServerLocalServerProcess): string | null {
  const cwd = server.cwd?.trim();
  if (!cwd) {
    return null;
  }
  const segments = cwd.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? null;
}

export function localServerMatchesRun(
  server: ServerLocalServerProcess,
  run: LocalServerRunIdentity,
): boolean {
  if (run.pid !== null && (server.pid === run.pid || server.ppid === run.pid)) {
    return true;
  }
  return Boolean(server.cwd && isWorkspaceRootWithin(server.cwd, run.cwd));
}

function firstAddressPort(server: ServerLocalServerProcess): readonly number[] {
  for (const address of server.addresses) {
    if (address.port > 0) {
      return [address.port];
    }
  }
  return [];
}
