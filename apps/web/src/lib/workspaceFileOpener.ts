import { isSupportedLocalPreviewFilePath } from "@glade/shared/attachments/localPreviewFiles";
import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  localPathsEqual,
  workspaceRelativePathOf,
} from "@glade/shared/platform/path";
import { isScratchWorkspacePath } from "@glade/shared/threads/threadWorkspace";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { readNativeApi } from "../nativeApi";
import { projectReadFileQueryOptions } from "./projectReactQuery";

export interface WorkspaceFileOpener {
  openFile: (path: string) => boolean;

  prefetchFile?: (path: string) => void;
}

export const WorkspaceFileOpenerContext = createContext<WorkspaceFileOpener | null>(null);

export function useWorkspaceFileOpener(): WorkspaceFileOpener | null {
  return useContext(WorkspaceFileOpenerContext);
}

const FILE_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const TRAILING_PATH_SEPARATOR_PATTERN = /[\\/]+$/;
const GLADE_PUBLIC_ASSET_PATH_PREFIXES = ["/brands/"] as const;
const GLADE_WEB_PUBLIC_WORKSPACE_DIR = "apps/web/public";

function resolveGladePublicAssetOpenTarget(path: string, workspaceRoot: string | null) {
  if (!workspaceRoot) {
    return null;
  }
  const normalizedPath = path.replace(/\\/g, "/");
  if (!GLADE_PUBLIC_ASSET_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    return null;
  }
  const relativePath = `${GLADE_WEB_PUBLIC_WORKSPACE_DIR}${normalizedPath}`;
  return isWorkspaceRelativePathSafe(relativePath) ? relativePath : null;
}

export function resolveWorkspaceDirectoryOpenTarget(
  rawPath: string,
  workspaceRoot: string | null,
): string | null {
  if (!workspaceRoot) {
    return null;
  }
  const withoutPosition = rawPath.trim().replace(FILE_POSITION_SUFFIX_PATTERN, "");
  if (withoutPosition.length === 0) {
    return null;
  }

  const directoryPath = withoutPosition
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== ".")
    .join("/");
  if (localPathsEqual(directoryPath, workspaceRoot)) {
    return "";
  }
  if (!TRAILING_PATH_SEPARATOR_PATTERN.test(withoutPosition)) {
    return null;
  }
  const withoutTrailingSeparators = directoryPath.replace(TRAILING_PATH_SEPARATOR_PATTERN, "");
  if (isWorkspaceRelativePathSafe(withoutTrailingSeparators)) {
    return withoutTrailingSeparators.replaceAll("\\", "/");
  }
  return workspaceRelativePathOf(withoutTrailingSeparators, workspaceRoot);
}

export function resolveWorkspaceFileOpenTarget(
  rawPath: string,
  workspaceRoot: string | null,
): string | null {
  const withoutPosition = rawPath.trim().replace(FILE_POSITION_SUFFIX_PATTERN, "");
  if (withoutPosition.length === 0) {
    return null;
  }
  if (isWorkspaceRelativePathSafe(withoutPosition)) {
    return withoutPosition;
  }
  if (!workspaceRoot) {
    return null;
  }
  const workspaceRelativePath = workspaceRelativePathOf(withoutPosition, workspaceRoot);
  if (workspaceRelativePath) {
    return workspaceRelativePath;
  }

  return resolveGladePublicAssetOpenTarget(withoutPosition, workspaceRoot);
}

function resolveScratchPreviewFileOpenTarget(rawPath: string): string | null {
  const withoutPosition = rawPath.trim().replace(FILE_POSITION_SUFFIX_PATTERN, "");
  if (!isScratchWorkspacePath(withoutPosition)) {
    return null;
  }
  return isSupportedLocalPreviewFilePath(withoutPosition) ? withoutPosition : null;
}

export function resolveDockFileOpenTarget(
  rawPath: string,
  workspaceRoot: string | null,
): string | null {
  const withoutPosition = rawPath.trim().replace(FILE_POSITION_SUFFIX_PATTERN, "");
  if (withoutPosition.length === 0) {
    return null;
  }
  const workspaceTarget = workspaceRoot
    ? resolveWorkspaceFileOpenTarget(rawPath, workspaceRoot)
    : null;
  if (workspaceTarget) {
    return workspaceTarget;
  }
  if (isLocalAbsolutePath(withoutPosition)) {
    return withoutPosition;
  }
  return resolveScratchPreviewFileOpenTarget(rawPath);
}

export function openWorkspaceFileReference(opener: WorkspaceFileOpener | null, path: string): void {
  if (opener?.openFile(path)) {
    return;
  }
  const api = readNativeApi();
  if (api) {
    void openInPreferredEditor(api, path).catch(() => undefined);
  } else {
    console.warn("Native API not found. Unable to open file in editor.");
  }
}

export function prefetchWorkspaceFile(
  queryClient: QueryClient,
  workspaceRoot: string,
  relativePath: string,
): void {
  if (isSupportedLocalPreviewFilePath(relativePath)) {
    return;
  }

  if (!relativePath.includes("/")) {
    return;
  }
  void queryClient.prefetchQuery(projectReadFileQueryOptions({ cwd: workspaceRoot, relativePath }));
  void import("./syntaxHighlighting")
    .then((module) =>
      module.getSyntaxHighlighterPromise(module.getSyntaxLanguageForPath(relativePath)),
    )
    .catch(() => undefined);
}
