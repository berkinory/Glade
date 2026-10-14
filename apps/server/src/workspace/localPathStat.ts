import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ProjectLocalPathEntry } from "@glade/contracts/workspace/project";

// A stat on a network or removable mount can block for seconds and hold a libuv worker the whole
// time, starving the server's other file reads; a reference there is not checked.
const SLOW_MOUNT_ROOTS = ["/Volumes/", "/net/", "/Network/", "/mnt/", "/media/", "/run/media/"];
const STAT_TIMEOUT_MS = 250;

function expandHomePath(reference: string, homeDir: string): string {
  if (reference === "~") return homeDir;
  return /^~[\\/]/.test(reference) ? path.join(homeDir, reference.slice(2)) : reference;
}

async function statWithin(target: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const stat = await Promise.race([fs.stat(target).catch(() => null), timeout]);
  clearTimeout(timer);
  return stat;
}

async function statLocalPath(
  reference: string,
  homeDir: string,
): Promise<ProjectLocalPathEntry | null> {
  const expanded = expandHomePath(reference.trim(), homeDir);
  if (expanded.includes("\0") || !path.isAbsolute(expanded) || /^[\\/]{2}/.test(expanded)) {
    return null;
  }
  const target = path.resolve(expanded);
  if (SLOW_MOUNT_ROOTS.some((root) => target.startsWith(root))) return null;
  const stat = await statWithin(target, STAT_TIMEOUT_MS);
  if (stat?.isFile()) return { path: target, kind: "file" };
  if (stat?.isDirectory()) return { path: target, kind: "directory" };
  return null;
}

/**
 * Whether absolute or home-relative paths a reply names exist, and as what. Only the kind is
 * reported; nothing is opened or read.
 */
export function statLocalPaths(input: {
  readonly paths: ReadonlyArray<string>;
  readonly homeDir: string;
}): Promise<Array<ProjectLocalPathEntry | null>> {
  return Promise.all(input.paths.map((reference) => statLocalPath(reference, input.homeDir)));
}
