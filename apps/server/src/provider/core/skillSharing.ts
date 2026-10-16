import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderShareSkillResult } from "@glade/contracts/provider/providerDiscovery";
import {
  agentSkillsDirs,
  discoverSkillsCatalog,
  forgetSkillsCatalog,
  gladeSkillsDir,
  sharedSkillsDir,
} from "./skillsCatalog.ts";

// Larger skills are never treated as identical copies, so they are kept rather than read in full.
const MAX_COMPARED_BYTES = 32 * 1024 * 1024;

async function sameTree(left: string, right: string, budget = { bytes: 0 }): Promise<boolean> {
  const [leftEntries, rightEntries] = await Promise.all([
    fs.readdir(left, { withFileTypes: true }),
    fs.readdir(right, { withFileTypes: true }),
  ]);
  if (leftEntries.length !== rightEntries.length) return false;
  const rightByName = new Map(rightEntries.map((entry) => [entry.name, entry]));
  for (const entry of leftEntries) {
    const other = rightByName.get(entry.name);
    const leftPath = nodePath.join(left, entry.name);
    const rightPath = nodePath.join(right, entry.name);
    if (!other) return false;
    if (entry.isSymbolicLink() || other.isSymbolicLink()) {
      if (!entry.isSymbolicLink() || !other.isSymbolicLink()) return false;
      if ((await fs.readlink(leftPath)) !== (await fs.readlink(rightPath))) return false;
    } else if (entry.isDirectory() || other.isDirectory()) {
      if (!entry.isDirectory() || !other.isDirectory()) return false;
      if (!(await sameTree(leftPath, rightPath, budget))) return false;
    } else {
      const [leftBytes, rightBytes] = await Promise.all([
        fs.readFile(leftPath),
        fs.readFile(rightPath),
      ]);
      budget.bytes += leftBytes.length;
      if (budget.bytes > MAX_COMPARED_BYTES || !leftBytes.equals(rightBytes)) return false;
    }
  }
  return true;
}

async function sameTreeOrFalse(left: string, right: string | null): Promise<boolean> {
  if (right === null) return false;
  try {
    return await sameTree(left, right);
  } catch {
    return false;
  }
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fs.realpath(path);
  } catch {
    return null;
  }
}

// A linked skill keeps pointing at the user's own folder, so dotfile setups stay intact.
async function moveSkillDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(nodePath.dirname(destination), { recursive: true });
  if ((await fs.lstat(source)).isSymbolicLink()) {
    await fs.symlink(await fs.realpath(source), destination, "junction");
    await fs.unlink(source);
    return;
  }
  try {
    await fs.rename(source, destination);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EXDEV") throw cause;
    await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

// Moves a skill from the agents' own folders into the shared one and removes the agent copies
// that are the same skill. A copy that differs is kept, so nothing the user wrote is lost.
export async function shareSkill(input: {
  readonly name: string;
  readonly homeDir: string;
  readonly gladeBaseDir: string;
}): Promise<ProviderShareSkillResult> {
  const catalog = await discoverSkillsCatalog({
    homeDir: input.homeDir,
    gladeBaseDir: input.gladeBaseDir,
    includeDuplicateOrigins: true,
    forceReload: true,
  });
  const key = input.name.trim().toLowerCase();
  const directories = catalog
    .filter(
      (skill) =>
        skill.name.toLowerCase() === key &&
        nodePath.basename(skill.path).toLowerCase() === "skill.md",
    )
    .map((skill) => nodePath.dirname(skill.path));
  const parentIs = (roots: ReadonlyArray<string>) => (directory: string) =>
    roots.some((root) => nodePath.resolve(root) === nodePath.resolve(nodePath.dirname(directory)));
  const agentCopies = directories.filter(parentIs(agentSkillsDirs(input.homeDir)));
  const [first] = agentCopies;
  if (!first) throw new Error(`No agent keeps its own copy of ${input.name}.`);

  const realpaths = new Map(
    await Promise.all(
      agentCopies.map(async (directory) => [directory, await realpathOrNull(directory)] as const),
    ),
  );
  let shared = directories.find(
    parentIs([sharedSkillsDir(input.homeDir), gladeSkillsDir(input.gladeBaseDir)]),
  );
  let movedFrom: string | null = null;
  let remaining = agentCopies;
  if (!shared) {
    shared = nodePath.join(sharedSkillsDir(input.homeDir), nodePath.basename(first));
    if (await realpathOrNull(shared)) {
      throw new Error(`The shared skills folder already has a ${nodePath.basename(first)} folder.`);
    }
    movedFrom = realpaths.get(first) ?? null;
    await moveSkillDirectory(first, shared);
    remaining = agentCopies.slice(1);
  }
  const sharedRealpath = await realpathOrNull(shared);

  const keptPaths: string[] = [];
  for (const directory of remaining) {
    // A copy reached through a linked parent folder can be gone once the first one moved.
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat) continue;
    const link = stat.isSymbolicLink();
    const realpath = realpaths.get(directory) ?? null;
    // A real folder that resolves to the shared copy is that copy, reached through a linked parent.
    const isSharedCopy = realpath !== null && realpath === sharedRealpath;
    const same =
      realpath !== null &&
      (link
        ? realpath === movedFrom ||
          isSharedCopy ||
          (await sameTreeOrFalse(realpath, sharedRealpath))
        : !isSharedCopy && (await sameTreeOrFalse(realpath, sharedRealpath)));
    if (!same) {
      if (!isSharedCopy) keptPaths.push(directory);
      continue;
    }
    await (link ? fs.unlink(directory) : fs.rm(directory, { recursive: true, force: true }));
  }
  forgetSkillsCatalog();
  return { keptPaths };
}
