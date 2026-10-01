import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  ProjectManageEntryInput,
  ProjectManageEntryResult,
} from "@glade/contracts/workspace/project";

import { resolveRealPathWithinRoot } from "./realPathContainment";

function validateName(name: string): void {
  if (
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /[\u0000-\u001f]/u.test(name)
  ) {
    throw new Error("Enter a single file or folder name.");
  }
}

function protectInternalPaths(relativePath: string): void {
  if (
    relativePath
      .split(/[\\/]/)
      .some((segment) => segment === ".git" || segment.startsWith(".glade"))
  ) {
    throw new Error("Glade and Git internal directories cannot be changed from Explorer.");
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export async function manageWorkspaceEntry(
  input: ProjectManageEntryInput,
  absolutePath: string,
): Promise<ProjectManageEntryResult> {
  protectInternalPaths(input.relativePath);
  validateName(path.basename(absolutePath));
  const parent = path.dirname(absolutePath);
  const realParent = await resolveRealPathWithinRoot(input.cwd, parent);
  if (realParent === null) throw new Error("Entry is outside the workspace.");

  if (input.action === "create") {
    if (input.nextName !== undefined) throw new Error("Unexpected destination name.");
    if (input.kind === "directory") {
      await fs.mkdir(absolutePath);
    } else {
      const handle = await fs.open(absolutePath, "wx");
      await handle.close();
    }
    return { relativePath: input.relativePath };
  }

  const stat = await fs.lstat(absolutePath);
  if (
    stat.isSymbolicLink() ||
    (input.kind === "directory" ? !stat.isDirectory() : !stat.isFile())
  ) {
    throw new Error("The entry type changed. Refresh Explorer and try again.");
  }
  const realSource = await resolveRealPathWithinRoot(input.cwd, absolutePath);
  if (realSource === null) throw new Error("Entry is outside the workspace.");

  if (input.action === "delete") {
    if (input.nextName !== undefined) throw new Error("Unexpected destination name.");
    await fs.rm(absolutePath, { recursive: input.kind === "directory" });
    return { relativePath: input.relativePath };
  }

  const nextName = input.nextName?.trim();
  if (!nextName) throw new Error("Enter a new name.");
  validateName(nextName);
  const nextRelativePath = path.posix.join(path.posix.dirname(input.relativePath), nextName);
  protectInternalPaths(nextRelativePath);
  const destination = path.join(parent, nextName);
  const existing = await fs.lstat(destination).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (existing) throw new Error("A file or folder with that name already exists.");
  await fs.rename(absolutePath, destination);
  return { relativePath: nextRelativePath };
}
