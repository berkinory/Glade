import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, expect, test } from "vitest";

import { manageWorkspaceEntry } from "./workspaceEntryMutation";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("creates, renames, and deletes entries inside the workspace", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "glade-explorer-"));
  roots.push(cwd);
  await manageWorkspaceEntry(
    { cwd, action: "create", kind: "directory", relativePath: "notes" },
    path.join(cwd, "notes"),
  );
  await manageWorkspaceEntry(
    { cwd, action: "create", kind: "file", relativePath: "notes/a.md" },
    path.join(cwd, "notes/a.md"),
  );
  await manageWorkspaceEntry(
    { cwd, action: "rename", kind: "file", relativePath: "notes/a.md", nextName: "b.md" },
    path.join(cwd, "notes/a.md"),
  );
  expect(await fs.readFile(path.join(cwd, "notes/b.md"), "utf8")).toBe("");
  await manageWorkspaceEntry(
    { cwd, action: "delete", kind: "directory", relativePath: "notes" },
    path.join(cwd, "notes"),
  );
  await expect(fs.stat(path.join(cwd, "notes"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("rejects an outside parent and existing rename target", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "glade-explorer-"));
  roots.push(cwd);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "glade-explorer-outside-"));
  roots.push(outside);
  await expect(
    manageWorkspaceEntry(
      { cwd, action: "create", kind: "file", relativePath: "../outside" },
      path.join(outside, "outside"),
    ),
  ).rejects.toThrow("outside the workspace");
  await fs.writeFile(path.join(cwd, "a.txt"), "a");
  await fs.writeFile(path.join(cwd, "b.txt"), "b");
  await expect(
    manageWorkspaceEntry(
      { cwd, action: "rename", kind: "file", relativePath: "a.txt", nextName: "b.txt" },
      path.join(cwd, "a.txt"),
    ),
  ).rejects.toThrow("already exists");
  expect(await fs.readFile(path.join(cwd, "b.txt"), "utf8")).toBe("b");
});
