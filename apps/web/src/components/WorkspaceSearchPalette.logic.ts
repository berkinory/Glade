import { isLocalAbsolutePath, isWorkspaceRelativePathSafe } from "@glade/shared/platform/path";

import { expandProjectHomePath } from "~/lib/projectPaths";
import { resolveWorkspaceDirectoryOpenTarget } from "~/lib/workspaceFileOpener";

const FILE_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const HOME_PATH_PATTERN = /^~[\\/]./;

export interface PalettePathTarget {
  path: string;
  displayPath: string;
  kind: "file" | "directory";
}

// A pasted absolute or home path, or a relative path with a `:line` suffix, opens directly instead
// of being fuzzy-searched. The dock opener decides where the path is allowed to open.
export function resolvePalettePathTarget(
  query: string,
  workspaceRoot: string | null,
  homeDir: string | null,
): PalettePathTarget | null {
  const trimmed = query.trim();
  const withoutPosition = trimmed.replace(FILE_POSITION_SUFFIX_PATTERN, "");
  let path: string;
  if (HOME_PATH_PATTERN.test(trimmed)) {
    if (!homeDir) return null;
    path = expandProjectHomePath(trimmed, homeDir);
  } else if (isLocalAbsolutePath(withoutPosition)) {
    path = trimmed;
  } else if (withoutPosition !== trimmed && isWorkspaceRelativePathSafe(withoutPosition)) {
    path = trimmed;
  } else {
    return null;
  }
  const kind = /[\\/]$/.test(withoutPosition) ? "directory" : "file";
  // Only workspace folders can be revealed; any other folder would open as a file.
  if (kind === "directory" && resolveWorkspaceDirectoryOpenTarget(path, workspaceRoot) === null) {
    return null;
  }
  return { path, displayPath: withoutPosition.replaceAll("\\", "/"), kind };
}
