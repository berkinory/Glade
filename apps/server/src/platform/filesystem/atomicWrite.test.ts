import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileStringAtomically } from "./atomicWrite";
import { PRIVATE_FILE_MODE } from "./privatePathPermissions";

let directory: string;

const write = (input: Parameters<typeof writeFileStringAtomically>[0]) =>
  Effect.runPromise(writeFileStringAtomically(input).pipe(Effect.provide(NodeServices.layer)));

const tempEntries = () => fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp"));

const modeOf = (target: string) => fs.statSync(target).mode & 0o777;

describe.skipIf(process.platform === "win32")("private atomic writes", () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "glade-atomic-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates and replaces files with owner-only permissions", async () => {
    const filePath = path.join(directory, "state.json");
    fs.writeFileSync(filePath, "old", { mode: 0o644 });
    fs.chmodSync(filePath, 0o644);

    await write({ filePath, contents: "new" });

    expect(fs.readFileSync(filePath, "utf8")).toBe("new");
    expect(modeOf(filePath)).toBe(PRIVATE_FILE_MODE);
    expect(modeOf(directory)).toBe(0o700);
    expect(tempEntries()).toEqual([]);
  });

  it("allows concurrent writers without sharing temporary files", async () => {
    const filePath = path.join(directory, "state.json");
    const contents = Array.from({ length: 32 }, (_, index) => `value-${index}`);
    const reusableWrite = writeFileStringAtomically({ filePath, contents: contents[0]! });

    await Effect.runPromise(
      Effect.all(
        [
          ...contents.map((value) => writeFileStringAtomically({ filePath, contents: value })),
          ...Array.from({ length: 8 }, () => reusableWrite),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(contents).toContain(fs.readFileSync(filePath, "utf8"));
    expect(tempEntries()).toEqual([]);
  });

  it("replaces a final symlink without changing its outside target", async () => {
    const outsidePath = path.join(directory, "outside.json");
    const filePath = path.join(directory, "state.json");
    const hostileTempPath = `${filePath}.${process.pid}.hostile.tmp`;
    fs.writeFileSync(outsidePath, "outside", { mode: 0o644 });
    fs.symlinkSync(outsidePath, filePath);
    fs.symlinkSync(outsidePath, hostileTempPath);

    await write({ filePath, contents: "inside" });

    expect(fs.readFileSync(outsidePath, "utf8")).toBe("outside");
    expect(fs.lstatSync(filePath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(filePath, "utf8")).toBe("inside");
    expect(fs.lstatSync(hostileTempPath).isSymbolicLink()).toBe(true);
  });

  it("rejects a symlinked parent directory without changing its outside target", async () => {
    const outsideDirectory = path.join(directory, "outside");
    const linkedDirectory = path.join(directory, "linked");
    const outsidePath = path.join(outsideDirectory, "state.json");
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(outsidePath, "outside");
    fs.symlinkSync(outsideDirectory, linkedDirectory);

    await expect(
      write({ filePath: path.join(linkedDirectory, "state.json"), contents: "inside" }),
    ).rejects.toThrow(linkedDirectory);
    expect(fs.readFileSync(outsidePath, "utf8")).toBe("outside");
  });

  it("rejects a parent directory writable by other users", async () => {
    const filePath = path.join(directory, "state.json");
    fs.chmodSync(directory, 0o777);

    await expect(write({ filePath, contents: "private" })).rejects.toThrow("group/other writable");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(tempEntries()).toEqual([]);
  });

  it("enforces the requested mode even under a restrictive umask", async () => {
    const filePath = path.join(directory, "state.json");
    const previousUmask = process.umask(0o777);
    try {
      await write({ filePath, contents: "private", mode: 0o640 });
    } finally {
      process.umask(previousUmask);
    }

    expect(modeOf(filePath)).toBe(0o640);
  });

  it("repairs a newly created parent chain under a restrictive umask", async () => {
    const parentPath = path.join(directory, "new", "nested");
    const filePath = path.join(parentPath, "state.json");
    const previousUmask = process.umask(0o777);
    try {
      await write({ filePath, contents: "private" });
    } finally {
      process.umask(previousUmask);
    }

    expect(modeOf(path.join(directory, "new"))).toBe(0o700);
    expect(modeOf(parentPath)).toBe(0o700);
    expect(modeOf(filePath)).toBe(PRIVATE_FILE_MODE);
    expect(fs.readFileSync(filePath, "utf8")).toBe("private");
  });

  it("finishes an in-flight commit before interruption is observed", async () => {
    const filePath = path.join(directory, "state.bin");
    const contents = "x".repeat(32 * 1024 * 1024);

    const sawTemporaryFile = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          writeFileStringAtomically({ filePath, contents }).pipe(
            Effect.provide(NodeServices.layer),
          ),
        );
        const sawTemp = yield* Effect.promise(async () => {
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            if (tempEntries().length > 0) return true;
            if (fs.existsSync(filePath)) return false;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          return false;
        });
        yield* Fiber.interrupt(fiber);
        return sawTemp;
      }),
    );

    expect(sawTemporaryFile).toBe(true);
    expect(fs.statSync(filePath).size).toBe(Buffer.byteLength(contents));
    expect(tempEntries()).toEqual([]);
  });

  it("removes its temporary file when replacement fails", async () => {
    const filePath = path.join(directory, "state.json");
    fs.mkdirSync(filePath);

    await expect(write({ filePath, contents: "new" })).rejects.toBeDefined();
    expect(fs.statSync(filePath).isDirectory()).toBe(true);
    expect(tempEntries()).toEqual([]);
  });
});
