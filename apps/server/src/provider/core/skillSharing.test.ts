import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shareSkill } from "./skillSharing.ts";

const skillFile = (name: string, body = "Body") =>
  `---\nname: ${name}\ndescription: A skill\n---\n${body}\n`;

describe("shareSkill", () => {
  let homeDir: string;
  let gladeBaseDir: string;
  const at = (...segments: string[]) => nodePath.join(homeDir, ...segments);

  const writeSkill = async (directory: string, name: string, body?: string) => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(nodePath.join(directory, "SKILL.md"), skillFile(name, body));
  };

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "glade-share-skill-"));
    gladeBaseDir = at(".glade");
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("re-links a linked skill and leaves the folder it points to untouched", async () => {
    const source = at("dotfiles", "skills", "animate");
    await writeSkill(source, "animate");
    for (const agent of [".claude", ".codex"]) {
      await fs.mkdir(at(agent, "skills"), { recursive: true });
      await fs.symlink(source, at(agent, "skills", "animate"));
    }

    expect(await shareSkill({ name: "animate", homeDir, gladeBaseDir })).toEqual({ keptPaths: [] });

    const shared = at(".agents", "skills", "animate");
    expect((await fs.lstat(shared)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(shared)).toBe(await fs.realpath(source));
    await expect(fs.lstat(at(".claude", "skills", "animate"))).rejects.toThrow();
    await expect(fs.lstat(at(".codex", "skills", "animate"))).rejects.toThrow();
    expect(await fs.readFile(nodePath.join(source, "SKILL.md"), "utf8")).toBe(skillFile("animate"));
  });

  it("removes identical copies and keeps one that differs", async () => {
    await writeSkill(at(".claude", "skills", "review"), "review");
    await writeSkill(at(".codex", "skills", "review"), "review");
    await writeSkill(at(".grok", "skills", "review"), "review", "Edited by hand");

    const { keptPaths } = await shareSkill({ name: "review", homeDir, gladeBaseDir });

    expect(keptPaths).toEqual([at(".grok", "skills", "review")]);
    expect(await fs.readFile(at(".agents", "skills", "review", "SKILL.md"), "utf8")).toBe(
      skillFile("review"),
    );
    await expect(fs.lstat(at(".claude", "skills", "review"))).rejects.toThrow();
    await expect(fs.lstat(at(".codex", "skills", "review"))).rejects.toThrow();
    expect(await fs.readFile(at(".grok", "skills", "review", "SKILL.md"), "utf8")).toBe(
      skillFile("review", "Edited by hand"),
    );
  });

  it("never deletes the shared copy when an agent's folder links to the shared one", async () => {
    await writeSkill(at(".agents", "skills", "notes"), "notes");
    await fs.mkdir(at(".claude"), { recursive: true });
    await fs.symlink(at(".agents", "skills"), at(".claude", "skills"));
    await writeSkill(at(".codex", "skills", "notes"), "notes");

    await shareSkill({ name: "notes", homeDir, gladeBaseDir });

    expect(await fs.readFile(at(".agents", "skills", "notes", "SKILL.md"), "utf8")).toBe(
      skillFile("notes"),
    );
    await expect(fs.lstat(at(".codex", "skills", "notes"))).rejects.toThrow();
  });
});
