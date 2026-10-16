import { beforeEach, describe, expect, it, vi } from "vitest";

const tree = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock("../platform/outboundHttp/outboundHttp.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../platform/outboundHttp/outboundHttp.ts")>();
  return {
    ...original,
    outboundHttp: {
      request: async () => ({
        status: 200,
        headers: new Headers(),
        url: "https://api.github.com",
        body: new TextEncoder().encode(JSON.stringify({ tree: tree.entries, truncated: false })),
      }),
    },
  };
});

const { readSkillFolder } = await import("./githubSkills.ts");

const COMMIT = "a".repeat(40);
const file = (path: string, mode = "100644") => ({ path, mode, type: "blob", size: 10 });

describe("readSkillFolder", () => {
  beforeEach(() => {
    tree.entries = [];
  });

  it("lists the plain files of the skill folder only", async () => {
    tree.entries = [
      file("skills/pdf/SKILL.md"),
      file("skills/pdf/scripts/run.py", "100755"),
      { path: "skills/pdf/scripts", mode: "040000", type: "tree" },
      file("skills/other/SKILL.md"),
      file("README.md"),
    ];
    const folder = await readSkillFolder("anthropics/skills", COMMIT, "skills/pdf");
    expect(folder.files).toEqual([
      { path: "SKILL.md", size: 10, executable: false },
      { path: "scripts/run.py", size: 10, executable: true },
    ]);
  });

  it.each([
    ["a symlink", file("skills/pdf/escape", "120000"), /link or submodule/u],
    ["a submodule", { path: "skills/pdf/vendor", mode: "160000", type: "commit" }, /submodule/u],
    ["a path leaving the folder", file("skills/pdf/a/../../../etc"), /unsafe path/u],
    ["a file over 5 MB", { ...file("skills/pdf/big.bin"), size: 6 * 1024 * 1024 }, /5 MB/u],
  ])("refuses a skill folder with %s", async (_, entry, message) => {
    tree.entries = [file("skills/pdf/SKILL.md"), entry];
    await expect(readSkillFolder("anthropics/skills", COMMIT, "skills/pdf")).rejects.toThrow(
      message,
    );
  });

  it.each([
    ["a repository name", "anthropics/skills/extra", COMMIT, "skills/pdf"],
    ["a commit", "anthropics/skills", "main", "skills/pdf"],
    ["a folder", "anthropics/skills", COMMIT, "../outside"],
  ])("refuses an install request with an invalid %s", async (_, repository, commit, path) => {
    await expect(readSkillFolder(repository, commit, path)).rejects.toThrow();
  });
});
