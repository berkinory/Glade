import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, expect, test } from "vitest";

import { statLocalPaths } from "./localPathStat";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("reports only what absolute and home-relative paths are, never relative ones", async () => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "glade-local-path-")));
  roots.push(home);
  await fs.mkdir(path.join(home, ".ssh"));
  await fs.writeFile(path.join(home, ".hushlogin"), "");

  const entries = await statLocalPaths({
    homeDir: home,
    paths: [
      "~/.hushlogin",
      "~/.ssh",
      path.join(home, ".hushlogin"),
      path.join(home, "missing.txt"),
      ".hushlogin",
      "../.hushlogin",
    ],
  });

  expect(entries).toEqual([
    { path: path.join(home, ".hushlogin"), kind: "file" },
    { path: path.join(home, ".ssh"), kind: "directory" },
    { path: path.join(home, ".hushlogin"), kind: "file" },
    null,
    null,
    null,
  ]);
});
