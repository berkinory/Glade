import { stat, realpath } from "node:fs/promises";
import path from "node:path";

// Canonical working-tree root of the checkout containing `cwd`: the nearest ancestor holding a
// `.git` entry after resolving symlinks. Linked worktrees have their own `.git` file, so each one
// is a separate checkout. Returns null outside a checkout.
export async function resolveCheckoutRoot(cwd: string): Promise<string | null> {
  let directory = await realpath(cwd).catch(() => null);
  while (directory !== null) {
    const hasGitEntry = await stat(path.join(directory, ".git")).then(
      () => true,
      () => false,
    );
    if (hasGitEntry) return directory;
    const parent = path.dirname(directory);
    directory = parent === directory ? null : parent;
  }
  return null;
}
