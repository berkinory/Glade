import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  LOCAL_IMAGE_ROUTE_PATH,
  isSupportedLocalImagePath,
  isSupportedLocalPreviewFilePath,
} from "@glade/shared/localPreviewFiles";
import { SCRATCH_WORKSPACES_DIRNAME } from "@glade/shared/threadWorkspace";

import { resolveCodexGeneratedImagesRoots } from "./codexGeneratedImages.ts";

export { LOCAL_IMAGE_ROUTE_PATH };

export interface ResolvedLocalPreviewFile {
  readonly path: string;
  readonly fileName: string;

  readonly sizeBytes: number;
}

export interface LocalPreviewGrantResult {
  readonly grant: string;
  readonly expiresAt: string;
}

const LOCAL_PREVIEW_GRANT_TTL_MS = 2 * 60 * 1000;
const localPreviewGrantByToken = new Map<string, { realFilePath: string; expiresAtMs: number }>();

function pruneExpiredPreviewGrants(nowMs = Date.now()): void {
  for (const [token, grant] of localPreviewGrantByToken) {
    if (grant.expiresAtMs <= nowMs) {
      localPreviewGrantByToken.delete(token);
    }
  }
}

function hasValidPreviewGrant(input: {
  readonly token: string | null | undefined;
  readonly realFilePath: string;
}): boolean {
  return resolveLocalPreviewGrantRealPath({ token: input.token }) === input.realFilePath;
}

export function resolveLocalPreviewGrantRealPath(input: {
  readonly token: string | null | undefined;
}): string | null {
  const token = input.token?.trim();
  if (!token) {
    return null;
  }
  const nowMs = Date.now();
  pruneExpiredPreviewGrants(nowMs);
  const grant = localPreviewGrantByToken.get(token);
  return grant !== undefined && grant.expiresAtMs > nowMs ? grant.realFilePath : null;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function realpathOrNull(candidate: string | undefined): Promise<string | null> {
  if (!candidate) {
    return null;
  }
  try {
    return await fs.realpath(candidate);
  } catch {
    return null;
  }
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    try {
      const stat = await fs.stat(path.join(current, ".git"));
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function temporaryDirectoryRoots(): Promise<string[]> {
  const candidates = [
    os.tmpdir(),
    process.env.TMPDIR,
    process.platform === "darwin" ? "/tmp" : undefined,
  ];
  const roots = await Promise.all(Array.from(new Set(candidates)).map(realpathOrNull));
  return Array.from(new Set(roots.filter((root): root is string => root !== null)));
}

async function resolveWorkspaceRoot(cwd: string | null): Promise<string | null> {
  if (!cwd) {
    return null;
  }
  const realCwd = await realpathOrNull(cwd);
  if (!realCwd) {
    return null;
  }
  const gitRoot = await findGitRoot(realCwd);
  return (gitRoot ? await realpathOrNull(gitRoot) : realCwd) ?? null;
}

export async function resolveAllowedLocalPreviewFile(input: {
  readonly requestedPath: string | null;
  readonly cwd: string | null;
  readonly codexHomePath?: string;
  readonly scratchWorkspacesRoot?: string;
  readonly allowAbsoluteLocalPreviewFile?: boolean;
  readonly previewGrant?: string | null;
}): Promise<ResolvedLocalPreviewFile | null> {
  const requestedPath = input.requestedPath?.trim();
  if (
    !requestedPath ||
    requestedPath.includes("\0") ||
    !isSupportedLocalPreviewFilePath(requestedPath)
  ) {
    return null;
  }

  const resolvedRequestedPath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(input.cwd ?? process.cwd(), requestedPath);
  const realFilePath = await realpathOrNull(resolvedRequestedPath);
  if (!realFilePath || !isSupportedLocalPreviewFilePath(realFilePath)) {
    return null;
  }

  const stat = await fs.stat(realFilePath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }
  const resolved: ResolvedLocalPreviewFile = {
    path: realFilePath,
    fileName: path.basename(realFilePath),
    sizeBytes: stat.size,
  };

  const workspaceRoot = await resolveWorkspaceRoot(input.cwd);
  if (workspaceRoot !== null && isPathInside(realFilePath, workspaceRoot)) {
    return resolved;
  }

  const tempRoots = await temporaryDirectoryRoots();
  const configuredScratchRoot = await realpathOrNull(input.scratchWorkspacesRoot);
  const scratchWorkspaceRoots = [
    ...(configuredScratchRoot ? [configuredScratchRoot] : []),
    ...tempRoots.map((root) => path.join(root, SCRATCH_WORKSPACES_DIRNAME)),
  ];
  if (scratchWorkspaceRoots.some((root) => isPathInside(realFilePath, root))) {
    return resolved;
  }

  if (
    input.allowAbsoluteLocalPreviewFile === true &&
    path.isAbsolute(requestedPath) &&
    hasValidPreviewGrant({ token: input.previewGrant, realFilePath })
  ) {
    return resolved;
  }

  if (!isSupportedLocalImagePath(realFilePath)) {
    return null;
  }
  const generatedImagesRoots = await Promise.all(
    resolveCodexGeneratedImagesRoots(input.codexHomePath).map(realpathOrNull),
  ).then((roots) => roots.filter((root): root is string => root !== null));
  const allowed =
    generatedImagesRoots.some((root) => isPathInside(realFilePath, root)) ||
    tempRoots.some((root) => isPathInside(realFilePath, root));
  return allowed ? resolved : null;
}

export async function createLocalPreviewGrant(input: {
  readonly requestedPath: string;
}): Promise<LocalPreviewGrantResult> {
  const requestedPath = input.requestedPath.trim();
  if (!requestedPath || requestedPath.includes("\0") || !path.isAbsolute(requestedPath)) {
    throw new Error("Only absolute local files can be granted.");
  }

  const realFilePath = await realpathOrNull(path.resolve(requestedPath));
  if (!realFilePath) {
    throw new Error("Preview file not found.");
  }
  const stat = await fs.stat(realFilePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("Preview path is not a file.");
  }

  const expiresAtMs = Date.now() + LOCAL_PREVIEW_GRANT_TTL_MS;
  const grant = crypto.randomUUID();
  localPreviewGrantByToken.set(grant, { realFilePath, expiresAtMs });
  pruneExpiredPreviewGrants();
  return { grant, expiresAt: new Date(expiresAtMs).toISOString() };
}
