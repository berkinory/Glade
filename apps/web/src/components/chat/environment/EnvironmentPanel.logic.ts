import {
  isWindowsAbsolutePath,
  localPathsEqual,
  workspaceRelativePathOf,
} from "@glade/shared/platform/path";

export function formatEnvironmentDirectory(path: string, homeDir: string | null): string {
  if (!homeDir) return path;
  const windows = isWindowsAbsolutePath(homeDir);
  const homeLabel = windows ? "%USERPROFILE%" : "~";
  if (localPathsEqual(path, homeDir)) return homeLabel;
  const relative = workspaceRelativePathOf(path, homeDir);
  if (relative === null) return path;
  return windows ? `${homeLabel}\\${relative.replaceAll("/", "\\")}` : `${homeLabel}/${relative}`;
}
