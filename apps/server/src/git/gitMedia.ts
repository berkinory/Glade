import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeEffectProcessCommand } from "../platform/effectProcessRuntime";
import { GitCommandError } from "./Errors";

export const GIT_MEDIA_MAX_BYTES = 16_000_000;

export function readGitMedia(cwd: string, blob: string, size: number) {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        makeEffectProcessCommand("git", ["cat-file", "blob", blob], { cwd, env: process.env }),
      );
      yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const results = yield* Effect.all(
        [
          Stream.runForEach(child.stdout, (chunk) =>
            Effect.gen(function* () {
              bytes += chunk.byteLength;
              if (bytes > size || bytes > GIT_MEDIA_MAX_BYTES)
                return yield* new GitCommandError({
                  operation: "read media",
                  cwd,
                  command: "git cat-file",
                  detail: "Media exceeds the preview budget.",
                });
              chunks.push(chunk);
            }),
          ),
          Stream.runDrain(child.stderr),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (Number(results[2]) !== 0 || bytes !== size)
        return yield* new GitCommandError({
          operation: "read media",
          cwd,
          command: "git cat-file",
          detail: "Selected media content is unavailable.",
        });
      return Buffer.concat(chunks).toString("base64");
    }),
  ).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(
      (cause) =>
        new GitCommandError({
          operation: "read media",
          cwd,
          command: "git cat-file",
          detail: "Could not read selected media.",
          cause,
        }),
    ),
  );
}

export function readWorkingTreeMedia(cwd: string, relativePath: string, maxBytes: number) {
  return Effect.tryPromise({
    try: async () => {
      const root = await fs.realpath(cwd);
      let realPath: string;
      try {
        realPath = await fs.realpath(path.join(root, relativePath));
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return { contents: "", resolvedRev: "workingTree", missing: true, truncated: false };
        throw cause;
      }
      const relative = path.relative(root, realPath);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error("Media path escapes the workspace.");
      const handle = await fs.open(realPath, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("Media path must be a file.");
        if (stat.size > maxBytes)
          return { contents: "", resolvedRev: "workingTree", missing: false, truncated: true };
        const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > maxBytes || length > stat.size)
          return { contents: "", resolvedRev: "workingTree", missing: false, truncated: true };
        return {
          contents: buffer.subarray(0, length).toString("base64"),
          resolvedRev: "workingTree",
          missing: false,
          truncated: false,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new GitCommandError({
        operation: "read media",
        cwd,
        command: "read file",
        detail: "Could not read working-tree media.",
        cause,
      }),
  });
}
