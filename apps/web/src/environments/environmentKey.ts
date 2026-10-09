// Identifies a server this window talks to: the local one the desktop starts, a saved SSH host, or a
// paired machine. The key comes from how the client reaches the server, so it survives tunnel ports
// and tokens.
export type EnvironmentKey = "local" | `ssh:${string}` | `paired:${string}`;

export const LOCAL_ENVIRONMENT: EnvironmentKey = "local";

export function sshEnvironmentKey(hostId: string): EnvironmentKey {
  return `ssh:${hostId}`;
}

export function pairedEnvironmentKey(machineId: string): EnvironmentKey {
  return `paired:${machineId}`;
}
