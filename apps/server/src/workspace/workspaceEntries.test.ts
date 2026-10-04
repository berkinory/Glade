import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "../platform/processRunner";
import type { WorkspaceGitRunner } from "./workspaceEntries";
import * as workspace from "./workspaceEntries";

const roots: string[] = [];
const runGit: WorkspaceGitRunner = (args, options) => runProcess("git", args, options);
async function fixture(git = true) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "glade-entry-search-"));
  roots.push(cwd);
  if (git) await runGit(["init", "-q"], { cwd });
  return cwd;
}
async function write(cwd: string, relative: string, contents = "") {
  await fs.mkdir(path.dirname(path.join(cwd, relative)), { recursive: true });
  await fs.writeFile(path.join(cwd, relative), contents);
}
async function search(cwd: string, query: string, runner = runGit, limit = 80) {
  return workspace.searchWorkspaceEntries({ cwd, query, limit, kind: "file" }, runner);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cwd of roots.splice(0)) {
    workspace.clearWorkspaceIndexCache(cwd);
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

describe("workspace file search", () => {
  it("uses the same nested exclusions in Git and filesystem scans, including tracked ignored files", async () => {
    const cwd = await fixture();
    await write(cwd, "src/visible.ts");
    await write(cwd, "src/dist/generated.ts");
    await write(cwd, "src/node_modules/dependency.ts");
    await write(cwd, "src/secret.ts");
    await runGit(["add", "."], { cwd });
    await write(cwd, "src/.gitignore", "secret.ts\n");
    const fromGit = await search(cwd, "", runGit);
    workspace.clearWorkspaceIndexCache(cwd);
    const filesystem: WorkspaceGitRunner = (args, options) =>
      args.includes("ls-files")
        ? Promise.reject(new Error("Git listing unavailable"))
        : runGit(args, options);
    const fromFilesystem = await search(cwd, "", filesystem);
    expect(fromGit.entries.map((entry) => entry.path).toSorted()).toEqual([
      "src/.gitignore",
      "src/visible.ts",
    ]);
    expect(fromFilesystem.entries.map((entry) => entry.path).toSorted()).toEqual(
      fromGit.entries.map((entry) => entry.path).toSorted(),
    );
    expect(fromGit.truncated).toBe(false);
  });

  it("finds typoed and canonically equivalent multilingual filenames without rewriting paths", async () => {
    const cwd = await fixture(false);
    const names = [
      "Composer.tsx",
      "müşteri.ts",
      "Işık.ts",
      "İşlem.ts",
      "客户.ts",
      "заказ.ts",
      "cafe\u0301.ts",
    ];
    for (const name of names) await write(cwd, `src/${name}`);
    for (const [query, expected] of [
      ["Composre", "Composer.tsx"],
      ["Composxer", "Composer.tsx"],
      ["Compoer", "Composer.tsx"],
      ["Composxr", "Composer.tsx"],
      ["src/Composre.tsx", "Composer.tsx"],
      ["müsteri", "müşteri.ts"],
      ["ışık", "Işık.ts"],
      ["işlem", "İşlem.ts"],
      ["客户", "客户.ts"],
      ["заказ", "заказ.ts"],
      ["café", "cafe\u0301.ts"],
    ]) {
      expect((await search(cwd, query!)).entries[0]?.path).toBe(`src/${expected}`);
    }
    expect((await search(cwd, "cmp")).entries).toEqual([]);
    expect((await search(cwd, "zz")).entries).toEqual([]);
  });

  it("keeps files after the former combined file/directory limit searchable", async () => {
    const cwd = await fixture();
    for (let directory = 0; directory < 100; directory++) {
      const dir = path.join(cwd, `pkg${String(directory).padStart(3, "0")}`);
      await fs.mkdir(dir);
      await Promise.all(
        Array.from({ length: 260 }, (_, i) => fs.writeFile(path.join(dir, `file${i}.ts`), "")),
      );
    }
    await write(cwd, "zzz/last-file.ts");
    const result = await search(cwd, "last-file.ts");
    expect(result.entries[0]?.path).toBe("zzz/last-file.ts");
    expect(result.truncated).toBe(false);
  });

  it("serves an expired index during one refresh and cannot republish an invalidated build", async () => {
    const cwd = await fixture();
    await write(cwd, "old.ts");
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await search(cwd, "old.ts");
    now += 16_000;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const blocked: WorkspaceGitRunner = async (args, options) => {
      calls++;
      const result = await runGit(args, options);
      if (args.includes("check-ignore")) {
        entered();
        await gate;
      }
      return result;
    };
    const stale = search(cwd, "old.ts", blocked);
    await started;
    // The gate remains closed: returning here proves the request did not await the refresh.
    expect((await stale).entries[0]?.path).toBe("old.ts");
    const refreshCalls = calls;
    await search(cwd, "old.ts", blocked);
    expect(calls).toBe(refreshCalls);
    workspace.clearWorkspaceIndexCache(cwd);
    await fs.rm(path.join(cwd, "old.ts"));
    await write(cwd, "new.ts");
    expect((await search(cwd, "new.ts")).entries[0]?.path).toBe("new.ts");
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await search(cwd, "old.ts")).entries).toEqual([]);
  });

  it("reports failed ignore evaluation instead of revealing ignored files", async () => {
    const cwd = await fixture();
    await write(cwd, "secret.ts");
    await write(cwd, ".gitignore", "secret.ts\n");
    const broken: WorkspaceGitRunner = (args, options) =>
      args.includes("check-ignore")
        ? Promise.reject(new Error("Git ignore check failed"))
        : runGit(args, options);
    await expect(search(cwd, "secret", broken)).rejects.toThrow("ignore rules");
  });
});
