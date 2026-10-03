import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceContentSearch } from "./WorkspaceContentSearch";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glade-content-cache-"));
  roots.push(directory);
  return directory;
}

describe("workspace content cache boundaries", () => {
  it("revalidates same-size edits even when the modification time is restored", async () => {
    const cwd = await root();
    const file = path.join(cwd, "entry.txt");
    await fs.writeFile(file, "first value\n");
    const stat = await fs.stat(file);
    const search = new WorkspaceContentSearch();
    const index = async () => ({
      entries: [{ path: "entry.txt", kind: "file" as const }],
      truncated: false,
    });
    expect((await search.search({ cwd, query: "first" }, index)).matches).toHaveLength(1);
    await fs.writeFile(file, "other value\n");
    await fs.utimes(file, stat.atime, stat.mtime);
    expect((await search.search({ cwd, query: "first" }, index)).matches).toHaveLength(0);
    expect((await search.search({ cwd, query: "other" }, index)).matches).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a cached file replaced by an escaping symlink",
    async () => {
      const cwd = await root();
      const external = await root();
      const file = path.join(cwd, "entry.txt");
      await fs.writeFile(file, "public value\n");
      const search = new WorkspaceContentSearch();
      const index = async () => ({
        entries: [{ path: "entry.txt", kind: "file" as const }],
        truncated: false,
      });
      expect((await search.search({ cwd, query: "public" }, index)).matches).toHaveLength(1);
      await fs.writeFile(path.join(external, "secret.txt"), "private value\n");
      await fs.unlink(file);
      await fs.symlink(path.join(external, "secret.txt"), file);
      expect((await search.search({ cwd, query: "private" }, index)).matches).toHaveLength(0);
    },
  );

  it("releases a cancelled search while a shared index is still being built", async () => {
    const cwd = await root();
    const controller = new AbortController();
    let finish!: (index: { entries: []; truncated: false }) => void;
    const index = new Promise<{ entries: []; truncated: false }>((resolve) => {
      finish = resolve;
    });
    const search = new WorkspaceContentSearch().search(
      { cwd, query: "value" },
      () => index,
      controller.signal,
    );
    controller.abort();
    await expect(search).rejects.toBe(controller.signal.reason);
    finish({ entries: [], truncated: false });
  });
});
