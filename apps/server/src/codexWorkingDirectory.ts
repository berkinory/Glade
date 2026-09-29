import { statSync } from "node:fs";

export function formatMissingCodexWorkingDirectoryError(cwd: string): string {
  return `Project working directory no longer exists: ${cwd}. Relocate or reconnect the project in Glade.`;
}

export function assertCodexWorkingDirectoryExists(cwd: string): void {
  try {
    const stats = statSync(cwd);
    if (!stats.isDirectory()) {
      throw new Error(
        `Project working directory is not a directory: ${cwd}. Relocate or reconnect the project in Glade.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(formatMissingCodexWorkingDirectoryError(cwd), { cause: error });
    }
    throw error;
  }
}
