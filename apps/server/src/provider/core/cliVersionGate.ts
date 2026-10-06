import { executableIdentity } from "@glade/shared/platform/executable";

const CLI_VERSION_GATE_TTL_MS = 10 * 60 * 1000;

export interface CliBinaryFingerprint {
  readonly path: string;
  readonly identity: string;
}

export interface CliVersionProbeResult {
  readonly version: string | null;
  // Captured before the probe runs, so a binary replaced mid-probe still reads as stale.
  readonly fingerprint: CliBinaryFingerprint | null;
}

export interface CliVersionGate {
  // Returns the cached verdict for `key` while it is fresh and its executable is unchanged.
  // Concurrent checks share one probe. Failures and unsupported versions are never cached.
  readonly check: (
    key: string,
    probe: () => Promise<CliVersionProbeResult>,
  ) => Promise<string | null>;
}

interface CliVersionGateEntry {
  readonly promise: Promise<string | null>;
  readonly generation: number;
  // Zero while the probe is pending.
  expiresAt: number;
  fingerprint: CliBinaryFingerprint | null;
}

// Bumped after provider updates: a Windows `.cmd` shim can keep its size and mtime across an
// upgrade, so the fingerprint alone would not notice.
let gateGeneration = 0;

export function invalidateCliVersionGates(): void {
  gateGeneration += 1;
}

export function cliBinaryFingerprint(path: string | null): CliBinaryFingerprint | null {
  const identity = path ? executableIdentity(path) : null;
  return path && identity ? { path, identity } : null;
}

function isStale(entry: CliVersionGateEntry, now: number): boolean {
  if (entry.generation !== gateGeneration) return true;
  if (entry.expiresAt === 0) return false;
  if (entry.expiresAt <= now) return true;
  // Nothing located at probe time means nothing to compare; that probe reported its own failure.
  return (
    entry.fingerprint !== null &&
    executableIdentity(entry.fingerprint.path) !== entry.fingerprint.identity
  );
}

export function makeCliVersionGate(options: {
  readonly isSupported: (version: string | null) => boolean;
}): CliVersionGate {
  const entries = new Map<string, CliVersionGateEntry>();

  return {
    check: (key, probe) => {
      const now = Date.now();
      const existing = entries.get(key);
      if (existing && !isStale(existing, now)) return existing.promise;

      for (const [otherKey, other] of entries) {
        if (isStale(other, now)) entries.delete(otherKey);
      }

      const forget = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      const entry: CliVersionGateEntry = {
        generation: gateGeneration,
        expiresAt: 0,
        fingerprint: null,
        promise: Promise.resolve()
          .then(probe)
          .then(
            ({ version, fingerprint }) => {
              if (options.isSupported(version)) {
                entry.fingerprint = fingerprint;
                entry.expiresAt = Date.now() + CLI_VERSION_GATE_TTL_MS;
              } else {
                forget();
              }
              return version;
            },
            (error: unknown) => {
              forget();
              throw error;
            },
          ),
      };
      entries.set(key, entry);
      return entry.promise;
    },
  };
}
