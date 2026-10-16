import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import type {
  SkillInstallInput,
  SkillPreview,
} from "@glade/contracts/transport/ws/skillsDirectoryRpc";

import { parseSkillFrontmatter } from "../provider/core/skillFrontmatter.ts";
import {
  forgetSkillsCatalog,
  providerSkillsDir,
  sharedSkillsDir,
} from "../provider/core/skillsCatalog.ts";
import {
  hasScripts,
  parseSkillReference,
  readRepositoryFile,
  readSkillFolder,
  resolveSkillFolder,
} from "./githubSkills.ts";
import { skillAudits } from "./skillsShDirectory.ts";

const MAX_INSTRUCTIONS_CHARS = 64 * 1024;

export async function previewSkill(reference: string): Promise<SkillPreview> {
  const parsed = parseSkillReference(reference);
  if (!parsed) {
    throw new Error("Paste a skills.sh skill, a GitHub repository or a skill folder URL.");
  }
  const folder = await resolveSkillFolder(parsed);
  const skillMd = new TextDecoder().decode(
    await readRepositoryFile(
      folder.repository,
      folder.commit,
      folder.path ? `${folder.path}/SKILL.md` : "SKILL.md",
    ),
  );
  const frontmatter = parseSkillFrontmatter(skillMd);
  const fallbackName = nodePath.posix.basename(folder.path) || folder.repository.split("/")[1];
  const name = typeof frontmatter.name === "string" ? frontmatter.name : (fallbackName ?? "skill");
  return {
    repository: folder.repository,
    commit: folder.commit,
    path: folder.path,
    name,
    description: typeof frontmatter.description === "string" ? frontmatter.description : null,
    instructions: skillMd.slice(0, MAX_INSTRUCTIONS_CHARS),
    files: folder.files.map(({ path, size }) => ({ path, size })),
    hasScripts: hasScripts(folder.files),
    audits: await skillAudits(folder.repository, parsed.skillId ?? name),
  };
}

async function exists(path: string): Promise<boolean> {
  return fs.lstat(path).then(
    () => true,
    () => false,
  );
}

// Installs the folder as it is at the pinned commit. Nothing is written when any destination
// already has a folder of that name.
export async function installSkill(
  input: SkillInstallInput & { readonly homeDir: string },
): Promise<string[]> {
  const folder = await readSkillFolder(input.repository, input.commit, input.path);
  const folderName = nodePath.posix.basename(folder.path) || input.repository.split("/")[1] || "";
  if (!/^[A-Za-z0-9_.-]+$/u.test(folderName) || folderName.startsWith(".")) {
    throw new Error("The skill's folder name cannot be used on this computer.");
  }
  const roots =
    input.providers === null
      ? [sharedSkillsDir(input.homeDir)]
      : [...new Set(input.providers.map((provider) => providerSkillsDir(provider, input.homeDir)))];
  if (roots.length === 0) throw new Error("Choose at least one agent.");
  const destinations = roots.map((root) => nodePath.join(root, folderName));
  for (const destination of destinations) {
    if (await exists(destination)) {
      throw new Error(`${destination} already exists. Remove it first to install this skill.`);
    }
  }

  const staging = await fs.mkdtemp(nodePath.join(os.tmpdir(), "glade-skill-"));
  try {
    for (const file of folder.files) {
      const bytes = await readRepositoryFile(
        folder.repository,
        folder.commit,
        folder.path ? `${folder.path}/${file.path}` : file.path,
      );
      const target = nodePath.join(staging, ...file.path.split("/"));
      await fs.mkdir(nodePath.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { mode: file.executable ? 0o755 : 0o644 });
    }
    for (const destination of destinations) {
      const parent = nodePath.dirname(destination);
      await fs.mkdir(parent, { recursive: true });
      const partial = nodePath.join(
        parent,
        `.${folderName}.glade-${randomBytes(4).toString("hex")}`,
      );
      await fs.cp(staging, partial, { recursive: true });
      await fs.rename(partial, destination);
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    forgetSkillsCatalog();
  }
  return destinations;
}
