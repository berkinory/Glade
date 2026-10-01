import { createHash } from "node:crypto";
import { Effect, FileSystem, Path } from "effect";
import type { CheckpointRef } from "@glade/contracts/core/baseSchemas";
import type {
  WorkspaceRestoreConfirmation,
  WorkspaceRestorePreview,
} from "@glade/contracts/orchestration/workspaceRestore";
import type { GitCoreShape } from "../git/Services/GitCore";
import { CheckpointInvariantError, type CheckpointStoreError } from "./Errors";
import type { ScopedRestoreInput } from "./Services/CheckpointStore";

export function validateRestoreConfirmation(
  preview: WorkspaceRestorePreview,
  confirmation: WorkspaceRestoreConfirmation | undefined,
) {
  if (!confirmation && preview.files.length === 0) return Effect.void;
  if (!confirmation || confirmation.fingerprint !== preview.fingerprint) {
    return Effect.fail(
      new CheckpointInvariantError({
        operation: "scopedRestore",
        detail: "Workspace restore preview is missing or outdated. Review the files again.",
      }),
    );
  }
  const conflicts = preview.files.filter(
    (file) => file.conflict && !confirmation.overwritePaths.includes(file.path),
  );
  if (conflicts.length)
    return Effect.fail(
      new CheckpointInvariantError({
        operation: "scopedRestore",
        detail: `Later edits require explicit permission: ${conflicts.map((file) => file.path).join(", ")}`,
      }),
    );
  return Effect.void;
}

export function validateRestorePaths(
  cwd: string,
  files: ReadonlyArray<string>,
  dependencies: { readonly fs: FileSystem.FileSystem; readonly path: Path.Path },
) {
  const { fs, path } = dependencies;
  return Effect.gen(function* () {
    const operation = "scopedRestore";
    const root = yield* fs.realPath(cwd);
    for (const file of files) {
      const parts = file.split("/");
      if (
        path.isAbsolute(file) ||
        parts.some((part) => part === ".." || part === "." || part.length === 0)
      )
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Unsafe checkpoint path: ${file}`,
        });
      for (let depth = 1; depth < parts.length; depth++) {
        const parent = path.join(root, ...parts.slice(0, depth));
        if ((yield* fs.exists(parent)) && (yield* fs.realPath(parent)) !== parent)
          return yield* new CheckpointInvariantError({
            operation,
            detail: `Checkpoint path traverses a symbolic link: ${file}`,
          });
      }
    }
  });
}

export function prepareScopedRestore(
  input: ScopedRestoreInput,
  dependencies: {
    readonly git: GitCoreShape;
    readonly fs: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly resolveCommit: (
      cwd: string,
      ref: CheckpointRef,
    ) => Effect.Effect<string | null, CheckpointStoreError>;
  },
) {
  const { git, fs, path, resolveCommit } = dependencies;
  return Effect.gen(function* () {
    const operation = "CheckpointStore.scopedRestore";
    const paths = new Map<string, { before: string; after: string }>();
    for (const turn of input.turns) {
      const before =
        (yield* resolveCommit(input.cwd, turn.beforeCheckpointRef)) ??
        (turn.fallbackBeforeCheckpointRef
          ? yield* resolveCommit(input.cwd, turn.fallbackBeforeCheckpointRef)
          : null);
      const after = yield* resolveCommit(input.cwd, turn.afterCheckpointRef);
      if (!before || !after)
        return yield* new CheckpointInvariantError({
          operation,
          detail: "A required turn checkpoint is unavailable.",
        });
      const diff = yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["diff", "--name-only", "--no-renames", "-z", before, after, "--", "."],
      });
      for (const file of diff.stdout.split("\0").filter(Boolean)) {
        const existing = paths.get(file);
        paths.set(file, { before: existing?.before ?? before, after });
      }
    }
    const entries = [...paths.entries()].toSorted(([left], [right]) => left.localeCompare(right));
    yield* validateRestorePaths(
      input.cwd,
      entries.map(([file]) => file),
      { fs, path },
    );
    if (!entries.length)
      return {
        fingerprint: createHash("sha256").update("empty").digest("hex"),
        files: [],
        restores: [],
      };
    return yield* Effect.acquireUseRelease(
      fs.makeTempDirectory({ prefix: "glade-scoped-restore-" }),
      (temporary) =>
        Effect.gen(function* () {
          const env = {
            ...process.env,
            GIT_INDEX_FILE: path.join(temporary, "index"),
            GIT_LITERAL_PATHSPECS: "1",
          };
          yield* git.execute({
            operation,
            cwd: input.cwd,
            args: ["read-tree", entries[0]![1].before],
            env,
          });
          yield* git.execute({ operation, cwd: input.cwd, args: ["add", "-A", "--", "."], env });
          const current = (yield* git.execute({
            operation,
            cwd: input.cwd,
            args: ["write-tree"],
            env,
          })).stdout.trim();
          const restores: Array<{ path: string; treeOid: string }> = [];
          const files: Array<{ path: string; conflict: boolean }> = [];
          const states: Array<ReadonlyArray<string>> = [];
          for (const [file, refs] of entries) {
            const values = yield* Effect.forEach([refs.before, refs.after, current], (tree) =>
              git
                .execute({
                  operation,
                  cwd: input.cwd,
                  args: ["ls-tree", "-z", tree, "--", file],
                  env,
                })
                .pipe(Effect.map((result) => result.stdout)),
            );
            const [before, after, actual] = values;
            states.push([file, before!, after!, actual!]);
            if (before === actual) continue;
            files.push({ path: file, conflict: after !== actual });
            restores.push({ path: file, treeOid: refs.before });
          }
          return {
            fingerprint: createHash("sha256").update(JSON.stringify(states)).digest("hex"),
            files,
            restores,
          };
        }),
      (temporary) => fs.remove(temporary, { recursive: true, force: true }),
    );
  }).pipe(
    Effect.catchTag("PlatformError", (cause) =>
      Effect.fail(
        new CheckpointInvariantError({
          operation: "scopedRestore",
          detail: "Cannot inspect the workspace restore.",
          cause,
        }),
      ),
    ),
  );
}
