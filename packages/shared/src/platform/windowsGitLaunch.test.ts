import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareProcess } from "./platformProcess";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    // Exercise Windows launch plans against real fixture files on POSIX hosts too.
    statSync: (file: string) =>
      fs.statSync(process.platform === "win32" ? file : file.replaceAll("\\", "/")),
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "glade-windows-git-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function install(relativePath: string): string {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "fixture executable");
  return file;
}

function launch(folder = "cmd", msystem?: string) {
  return prepareProcess("git", ["status"], {
    platform: "win32",
    env: { PATH: path.join(root, folder), PATHEXT: ".EXE", MSYSTEM: msystem },
    requireExecutable: true,
  });
}

describe("Git for Windows launch planning", () => {
  it.each(["ucrt64", "clangarm64", "mingw64", "mingw32"])(
    "runs the %s binary directly but preserves Git Bash's hook environment",
    (build) => {
      const launcher = install("cmd/git.EXE");
      install(`${build}/bin/git.exe`);
      expect(launch()).toMatchObject({
        command: path.win32.join(root, build, "bin", "git.exe"),
        args: ["status"],
        shell: false,
      });
      expect(launch("cmd", "MINGW64").command).toBe(launcher);
      expect(launch().command).toBe(path.win32.join(root, build, "bin", "git.exe"));
    },
  );

  it("prefers the new layout and re-resolves a cached binary removed by an upgrade", () => {
    const launcher = install("bin/git.EXE");
    const modern = install("ucrt64/bin/git.exe");
    const legacy = install("mingw64/bin/git.exe");
    expect(launch("bin").command).toBe(path.win32.normalize(modern));
    rmSync(modern);
    expect(launch("bin").command).toBe(path.win32.normalize(legacy));
    rmSync(legacy);
    expect(launch("bin").command).toBe(launcher);
  });

  it("leaves package-manager shims and unknown installations alone", () => {
    const shim = install("shims/git.EXE");
    const launcher = install("cmd/git.EXE");
    expect(launch().command).toBe(launcher);
    install("ucrt64/bin/git.exe");
    expect(launch("shims").command).toBe(shim);
  });
});
