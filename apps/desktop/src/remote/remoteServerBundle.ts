import {
  remoteServerBundleName,
  type RemoteServerTarget,
} from "@glade/shared/remote/remoteServerBundle";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { pipeline } from "node:stream/promises";

// Released builds let the host download the bundle straight from the release; only source and
// development builds, which have no release to download from, upload a locally built bundle.
export type RemoteServerBundle =
  | {
      readonly kind: "download";
      readonly url: string;
      readonly sha256: string;
      readonly sizeBytes: number | null;
    }
  | {
      readonly kind: "upload";
      readonly file: string;
      readonly sha256: string;
      readonly sizeBytes: number;
    };

export interface RemoteServerBundleSource {
  resolve(target: RemoteServerTarget): Promise<RemoteServerBundle>;
}

interface BundleSourceOptions {
  readonly version: string;
  // Source and development builds use bundles built by scripts/build-remote-server.ts.
  readonly localDirectory: string | null;
  readonly release: { readonly owner: string; readonly repo: string } | null;
}

async function sha256(file: string): Promise<string> {
  const hash = Crypto.createHash("sha256");
  await pipeline(FS.createReadStream(file), hash);
  return hash.digest("hex");
}

export function createRemoteServerBundleSource(
  options: BundleSourceOptions,
): RemoteServerBundleSource {
  const localDigests = new Map<string, { readonly mtimeMs: number; readonly sha256: string }>();

  async function local(directory: string, fileName: string, target: RemoteServerTarget) {
    const file = Path.join(directory, fileName);
    const stat = FS.statSync(file, { throwIfNoEntry: false });
    if (!stat) {
      throw new Error(
        `No ${target} server bundle at ${file}. Build it with: node scripts/build-remote-server.ts --target ${target}`,
      );
    }
    // A rebuilt bundle keeps its name, so its digest is cached only for one modification time.
    const cached = localDigests.get(file);
    const digest = cached?.mtimeMs === stat.mtimeMs ? cached.sha256 : await sha256(file);
    localDigests.set(file, { mtimeMs: stat.mtimeMs, sha256: digest });
    return { kind: "upload", file, sha256: digest, sizeBytes: stat.size } as const;
  }

  async function released(fileName: string, target: RemoteServerTarget) {
    const release = options.release;
    if (!release) throw new Error("This build of Glade does not know where its releases live.");
    const url = `https://github.com/${release.owner}/${release.repo}/releases/download/v${options.version}/${fileName}`;
    // GitHub records each release asset's SHA-256 when it is uploaded, so the release needs no
    // separate checksum files.
    const response = await fetch(
      `https://api.github.com/repos/${release.owner}/${release.repo}/releases/tags/v${options.version}`,
      { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`Could not read the Glade ${options.version} release.`);
    const { assets } = (await response.json()) as {
      readonly assets?: ReadonlyArray<{
        readonly name?: unknown;
        readonly digest?: unknown;
        readonly size?: unknown;
      }>;
    };
    const asset = assets?.find((candidate) => candidate.name === fileName);
    if (!asset) throw new Error(`Glade ${options.version} has no server for ${target} hosts.`);
    const digest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/u, "") : "";
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`The checksum published for Glade ${options.version} is malformed.`);
    }
    // The size only drives the progress bar; without it the download shows no percentage.
    const sizeBytes = typeof asset.size === "number" && asset.size > 0 ? asset.size : null;
    return { kind: "download", url, sha256: digest, sizeBytes } as const;
  }

  return {
    resolve(target) {
      const fileName = `${remoteServerBundleName(options.version, target)}.tar.gz`;
      return options.localDirectory !== null
        ? local(options.localDirectory, fileName, target)
        : released(fileName, target);
    },
  };
}
