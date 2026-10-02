import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProjectImportSource } from "@glade/contracts/workspace/project";
import { isContainedPath } from "./realPathContainment";

export async function importWorkspaceEntry(
  source: ProjectImportSource,
  destination: string,
  kind: "file" | "directory",
): Promise<void> {
  if (source.type === "contents") {
    if (kind !== "file") throw new Error("Clipboard contents must be a file.");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.base64))
      throw new Error("Invalid file contents.");
    await fs.writeFile(destination, Buffer.from(source.base64, "base64"), { flag: "wx" });
    return;
  }
  if (!path.isAbsolute(source.path)) throw new Error("The source must be an absolute file path.");
  const sourcePath = await fs.realpath(source.path);
  const stat = await fs.lstat(source.path);
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile()))
    throw new Error(
      "The source type changed or is a symbolic link. Choose a regular file or folder.",
    );
  if (kind === "directory" && isContainedPath(sourcePath, destination))
    throw new Error("A folder cannot be imported into itself.");
  let created = false;
  try {
    if (kind === "file") {
      await fs.copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      return;
    }
    await fs.mkdir(destination);
    created = true;
    await copyDirectory(sourcePath, destination);
  } catch (error) {
    if (created)
      throw new Error(
        `Import stopped. Some files were copied to ${path.basename(destination)}; review them before retrying. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "A file or folder with that name already exists. Rename it or choose another folder.",
        { cause: error },
      );
    throw error;
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  const directory = await fs.opendir(source);
  for await (const entry of directory) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error(`Cannot import symbolic links or special files: ${entry.name}`);
    if (stat.isDirectory()) {
      await fs.mkdir(to);
      await copyDirectory(from, to);
    } else {
      await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    }
  }
}
