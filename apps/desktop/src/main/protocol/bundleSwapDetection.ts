import { app } from "electron";
import * as OriginalFS from "original-fs";
export interface BundleSignature {
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: number;
}

interface BundleStatLike {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
}

function bundleSignatureFromStats(stats: BundleStatLike): BundleSignature {
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

export interface BundleIdentity {
  readonly path: string;
  readonly signature: BundleSignature | null;
}
export function readBundleSignature(bundlePath: string): BundleSignature | null {
  try {
    return bundleSignatureFromStats(OriginalFS.statSync(bundlePath));
  } catch {
    return null;
  }
}
export function captureStartupBundleIdentity(): BundleIdentity | null {
  if (!app.isPackaged) {
    return null;
  }
  const bundlePath = app.getAppPath();
  if (!isWatchableBundlePath(bundlePath)) {
    return null;
  }
  return { path: bundlePath, signature: readBundleSignature(bundlePath) };
}
