export interface BundleSignature {
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: number;
}

export interface BundleStatLike {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
}

export function bundleSignatureFromStats(stats: BundleStatLike): BundleSignature {
  return { size: stats.size, mtimeMs: stats.mtimeMs, inode: stats.ino };
}

export function isWatchableBundlePath(appPath: string): boolean {
  return appPath.endsWith(".asar");
}

export function isBundleSwapped(
  baseline: BundleSignature,
  current: BundleSignature | null,
): boolean {
  if (current === null) {
    return false;
  }
  return (
    current.size !== baseline.size ||
    current.mtimeMs !== baseline.mtimeMs ||
    current.inode !== baseline.inode
  );
}

export function isBundleStable(
  baseline: BundleSignature,
  current: BundleSignature | null,
): current is BundleSignature {
  return current !== null && !isBundleSwapped(baseline, current);
}
