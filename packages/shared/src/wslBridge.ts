import { parseWindowsWslUncPath } from "./platform/windowsProcess";

export interface WslWorkspace {
  readonly distribution: string;
  readonly linuxPath: string;
}

export function resolveWslWorkspace(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): WslWorkspace | null {
  return platform === "win32" ? parseWindowsWslUncPath(cwd) : null;
}

export function resolveExecutionWorkingDirectory(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolveWslWorkspace(cwd, platform)?.linuxPath ?? cwd;
}
