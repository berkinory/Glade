// Identifies a server this window talks to: the local one the desktop starts, or a saved SSH host.
// The key comes from how the client reaches the server, so it survives tunnel ports and tokens.
export type EnvironmentKey = "local" | `ssh:${string}`;

export const LOCAL_ENVIRONMENT: EnvironmentKey = "local";

export function sshEnvironmentKey(hostId: string): EnvironmentKey {
  return `ssh:${hostId}`;
}
