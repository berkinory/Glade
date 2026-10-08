export const REMOTE_SERVER_TARGETS = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
] as const;
export type RemoteServerTarget = (typeof REMOTE_SERVER_TARGETS)[number];

export function remoteServerBundleName(version: string, target: RemoteServerTarget): string {
  return `glade-remote-server-${version}-${target}`;
}

// One build of the bundle: two builds of the same version (a development rebuild) get different
// runtime directories, so a host never mistakes one for the other.
export function remoteServerRuntimeName(
  version: string,
  target: RemoteServerTarget,
  bundleSha256: string,
): string {
  return `${remoteServerBundleName(version, target)}-${bundleSha256.slice(0, 12)}`;
}

// Orders release versions (`1.2.3`, `1.2.3-beta.1`). A host never runs an older server than the one
// it already ran: older servers refuse the newer database schema.
export function compareRemoteServerVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const [release = ""] = version.split("+", 1);
    const [core = "", prerelease] = release.split("-", 2);
    return { parts: core.split(".").map((part) => Number(part) || 0), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

// Paths on the remote host, relative to its $HOME. Each build is unpacked into its own runtime
// directory so a newer desktop never overwrites files a running older server still has open.
export const REMOTE_SERVER_ROOT = ".glade/remote";
export const REMOTE_SERVER_RUNTIME_DIR = `${REMOTE_SERVER_ROOT}/runtime`;
export const REMOTE_SERVER_READY_FILE = ".glade-ready";
export const REMOTE_SERVER_NODE_PATH = "bin/node";
export const REMOTE_SERVER_LAUNCHER_PATH = "dist/remoteLauncher.mjs";
export const REMOTE_SERVER_SMOKE_PATH = "dist/runtimeDependencySmoke.mjs";
