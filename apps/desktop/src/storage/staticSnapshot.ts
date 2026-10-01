import fs from "node:fs";
import path from "node:path";

const ASAR_SUFFIX = ".asar";

export function findAsarArchivePath(candidatePath: string): string | null {
  const segments = candidatePath.split(/[/\\]/);
  const archiveIndex = segments.findIndex((segment) => segment.endsWith(ASAR_SUFFIX));
  if (archiveIndex === -1) {
    return null;
  }
  return segments.slice(0, archiveIndex + 1).join(path.sep);
}

function snapshotDirectoryName(signature: string): string {
  return signature.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export interface StaticSnapshotInput {
  readonly sourceDir: string;

  readonly cacheRoot: string;

  readonly signature: string;

  readonly sentinelFile?: string;
}

export interface StaticSnapshotResult {
  readonly dir: string;
  readonly reused: boolean;
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.writeFileSync(targetPath, fs.readFileSync(sourcePath));
    }
  }
}

function pruneStaleSnapshots(cacheRoot: string, keepName: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === keepName) continue;
    try {
      fs.rmSync(path.join(cacheRoot, entry.name), { recursive: true, force: true });
    } catch {}
  }
}

// Reuses an existing snapshot when the sentinel file is present; otherwise copies into a temp
// directory and atomically renames it into place, so a crash mid-copy can never yield a
// half-snapshot that looks complete, and a concurrent process racing the same signature safely
// loses the rename and reuses the winner's copy.
export function ensureStaticSnapshot(input: StaticSnapshotInput): StaticSnapshotResult {
  const sentinelFile = input.sentinelFile ?? "index.html";
  const snapshotName = snapshotDirectoryName(input.signature);
  const snapshotDir = path.join(input.cacheRoot, snapshotName);

  if (fs.existsSync(path.join(snapshotDir, sentinelFile))) {
    pruneStaleSnapshots(input.cacheRoot, snapshotName);
    return { dir: snapshotDir, reused: true };
  }

  if (!fs.existsSync(path.join(input.sourceDir, sentinelFile))) {
    throw new Error(`Static snapshot source is missing ${sentinelFile}: ${input.sourceDir}`);
  }

  fs.mkdirSync(input.cacheRoot, { recursive: true });
  const stagingDir = path.join(input.cacheRoot, `.staging-${snapshotName}-${process.pid}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    copyDirectoryRecursive(input.sourceDir, stagingDir);
    fs.renameSync(stagingDir, snapshotDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    // Lost the rename race to a concurrent process: its completed copy is equivalent, so serve that
    // instead of failing startup.
    if (fs.existsSync(path.join(snapshotDir, sentinelFile))) {
      return { dir: snapshotDir, reused: true };
    }
    throw error;
  }

  pruneStaleSnapshots(input.cacheRoot, snapshotName);
  return { dir: snapshotDir, reused: false };
}
