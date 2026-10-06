import { Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { GIT_READ_FILE_AT_REV_MAX_BYTES, type GitBlameLineResult } from "@glade/contracts/git/git";
import { isWorkspaceRelativePathSafe } from "@glade/shared/platform/path";
import { GitCommandError } from "../Errors.ts";
import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import { GIT_MEDIA_MAX_BYTES, readGitMedia, readWorkingTreeMedia } from "../gitMedia";
import { sourceControlInventory } from "../sourceControlInventory";
import { parseGitBlamePorcelain } from "../gitBlameParsing.ts";
import { summarizeGitNumstatOutputs } from "../gitStatusParsing.ts";
import type { GitCoreShape, ExecuteGitResult, GitWorkingTreePatch } from "../Services/GitCore.ts";
import { GitCommands } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { GitDiff } from "../Services/GitDiff.ts";
import { withIntentToAddIndex } from "../gitIntentToAddIndex.ts";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  createGitCommandError,
  truncateUtf8Prefix,
} from "./GitCommands.ts";

const EMPTY_TREE_OBJECT_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const UNCOMMITTED_BLAME_RESULT: GitBlameLineResult = {
  sha: "0".repeat(40),
  shortSha: "",
  author: "",
  authorEmail: "",
  authorTime: "",
  summary: "",
  uncommitted: true,
};

const WORKING_TREE_DIFF_TIMEOUT_MS = 15_000;

const BLAME_LINE_TIMEOUT_MS = 10_000;

interface PatchAccumulator {
  readonly chunks: string[];
  bytes: number;
  truncated: boolean;
  endsWithNewline: boolean;
}

function makePatchAccumulator(): PatchAccumulator {
  return { chunks: [], bytes: 0, truncated: false, endsWithNewline: false };
}

function appendPatchSegment(
  accumulator: PatchAccumulator,
  segment: string,
  segmentTruncated: boolean,
  maxOutputBytes: number,
): void {
  if (accumulator.truncated) return;
  if (segment.length === 0) {
    accumulator.truncated = segmentTruncated;
    return;
  }

  if (accumulator.bytes > 0 && !accumulator.endsWithNewline) {
    if (accumulator.bytes >= maxOutputBytes) {
      accumulator.truncated = true;
      return;
    }
    accumulator.chunks.push("\n");
    accumulator.bytes += 1;
    accumulator.endsWithNewline = true;
  }

  const segmentBytes = Buffer.byteLength(segment, "utf8");
  const remainingBytes = maxOutputBytes - accumulator.bytes;
  const retained =
    segmentBytes <= remainingBytes ? segment : truncateUtf8Prefix(segment, remainingBytes);
  const retainedBytes = retained === segment ? segmentBytes : Buffer.byteLength(retained, "utf8");
  if (retained.length > 0) {
    accumulator.chunks.push(retained);
    accumulator.bytes += retainedBytes;
    accumulator.endsWithNewline = retained.endsWith("\n");
  }
  accumulator.truncated = segmentTruncated || retainedBytes < segmentBytes;
}

function toWorkingTreePatch(accumulator: PatchAccumulator): GitWorkingTreePatch {
  return {
    patch: accumulator.chunks.join(""),
    truncated: accumulator.truncated,
  };
}

const makeGitDiff = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const commands = yield* GitCommands;
  const { executeGit } = commands;
  const { statusDetails, resolveBaseBranchForNoUpstream } = yield* GitStatus;
  const listUntrackedFiles = (
    cwd: string,
    operationPrefix: string,
    env?: NodeJS.ProcessEnv,
    filePath?: string,
  ) =>
    executeGit(
      `${operationPrefix}.untrackedFiles`,
      cwd,
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        ...(filePath === undefined ? [] : ["--", `:(literal)${filePath}`]),
      ],
      { allowNonZeroExit: true, ...(env ? { env } : {}) },
    ).pipe(
      // Embedded repositories are listed as directories; their contents are not part of this diff.
      Effect.map((result) =>
        result.stdout.split("\0").filter((entry) => entry.length > 0 && !entry.endsWith("/")),
      ),
    );

  const intentToAddGit = { fileSystem, executeGit };

  const readUntrackedPatches = (
    cwd: string,
    operationPrefix: string,
    accumulator: PatchAccumulator,
    files?: ReadonlyArray<string>,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  ) =>
    Effect.gen(function* () {
      if (accumulator.truncated) return toWorkingTreePatch(accumulator);
      const untrackedFiles = files ?? (yield* listUntrackedFiles(cwd, operationPrefix));
      if (untrackedFiles.length === 0) return toWorkingTreePatch(accumulator);
      const separatorBytes = accumulator.bytes > 0 && !accumulator.endsWithNewline ? 1 : 0;
      const remainingBytes = maxOutputBytes - accumulator.bytes - separatorBytes;
      if (remainingBytes <= 0) {
        accumulator.truncated = true;
        return toWorkingTreePatch(accumulator);
      }
      const result = yield* withIntentToAddIndex(
        intentToAddGit,
        cwd,
        untrackedFiles,
        `${operationPrefix}.untrackedIndex`,
        (env) =>
          executeGit(
            `${operationPrefix}.untrackedPatch`,
            cwd,
            [
              "diff",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-renames",
              "--relative",
              "--src-prefix=a/",
              "--dst-prefix=b/",
            ],
            {
              env,
              timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
              maxOutputBytes: remainingBytes,
              outputMode: "truncate",
            },
          ),
      );
      appendPatchSegment(
        accumulator,
        result.stdout,
        result.stdoutTruncated === true,
        maxOutputBytes,
      );
      return toWorkingTreePatch(accumulator);
    });

  // `--no-renames` keeps a new file from pairing with a deleted tracked one.
  const readUntrackedNumstats = (
    cwd: string,
    operationPrefix: string,
    files?: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const untrackedFiles = files ?? (yield* listUntrackedFiles(cwd, operationPrefix));
      if (untrackedFiles.length === 0) return "";
      return yield* withIntentToAddIndex(
        intentToAddGit,
        cwd,
        untrackedFiles,
        `${operationPrefix}.untrackedIndex`,
        (env) =>
          executeGit(
            `${operationPrefix}.untrackedNumstat`,
            cwd,
            ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--relative"],
            { env, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS, maxOutputBytes: 10_000_000 },
          ).pipe(Effect.map((result) => result.stdout)),
      );
    });

  const resolveBranchMergeBase = (cwd: string) =>
    Effect.gen(function* () {
      const details = yield* statusDetails(cwd, {
        refreshUpstream: "background",
        metadataOnly: true,
      });
      const baseBranch =
        details.upstreamRef ??
        (details.branch
          ? yield* resolveBaseBranchForNoUpstream(cwd, details.branch).pipe(
              Effect.catch(() => Effect.succeed(null)),
            )
          : null);
      if (!baseBranch) {
        return yield* createGitCommandError(
          "GitCore.readBranchPatch.base",
          cwd,
          ["merge-base", "<base>", "HEAD"],
          "Cannot resolve a base branch for the current branch diff.",
        );
      }

      const mergeBase = yield* executeGit(
        "GitCore.readBranchPatch.mergeBase",
        cwd,
        ["merge-base", baseBranch, "HEAD"],
        {
          fallbackErrorMessage: "Cannot resolve the merge base for the current branch diff.",
        },
      ).pipe(Effect.map((result) => result.stdout.trim()));
      if (mergeBase.length === 0) {
        return yield* createGitCommandError(
          "GitCore.readBranchPatch.mergeBase",
          cwd,
          ["merge-base", baseBranch, "HEAD"],
          "Cannot resolve the merge base for the current branch diff.",
        );
      }
      return mergeBase;
    });

  const readUnstagedPatch: GitCoreShape["readUnstagedPatch"] = (cwd, filePath) =>
    Effect.gen(function* () {
      if (filePath !== undefined && !isWorkspaceRelativePathSafe(filePath)) {
        return yield* createGitCommandError(
          "GitCore.readUnstagedPatch.path",
          cwd,
          ["diff"],
          "Invalid file path.",
        );
      }
      const tracked = yield* executeGit(
        "GitCore.readUnstagedPatch.trackedPatch",
        cwd,
        [
          "diff",
          "--patch",
          "--no-color",
          "--no-ext-diff",
          ...(filePath ? ["--", `:(literal)${filePath}`] : []),
        ],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        },
      );
      const accumulator = makePatchAccumulator();
      appendPatchSegment(
        accumulator,
        tracked.stdout,
        tracked.stdoutTruncated === true,
        DEFAULT_MAX_OUTPUT_BYTES,
      );
      const untrackedFiles = filePath
        ? yield* listUntrackedFiles(cwd, "GitCore.readUnstagedPatch", undefined, filePath)
        : undefined;
      return yield* readUntrackedPatches(
        cwd,
        "GitCore.readUnstagedPatch",
        accumulator,
        untrackedFiles,
      );
    });

  const readStagedPatch: GitCoreShape["readStagedPatch"] = (cwd, filePath) =>
    Effect.gen(function* () {
      if (filePath !== undefined && !isWorkspaceRelativePathSafe(filePath)) {
        return yield* createGitCommandError(
          "GitCore.readStagedPatch.path",
          cwd,
          ["diff"],
          "Invalid file path.",
        );
      }
      return yield* executeGit(
        "GitCore.readStagedPatch",
        cwd,
        [
          "diff",
          "--cached",
          "--patch",
          "--no-color",
          "--no-ext-diff",
          ...(filePath ? ["--", `:(literal)${filePath}`] : []),
        ],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        },
      ).pipe(
        Effect.map((result) => ({
          patch: result.stdout,
          truncated: result.stdoutTruncated === true,
        })),
      );
    });

  const inventories = yield* makeKeyedSingleFlightCache<ExecuteGitResult, GitCommandError>({
    maxEntries: 4,
    ttlMs: 2_000,
  });
  const readSourceControlFiles: GitCoreShape["readSourceControlFiles"] = (
    cwd,
    query,
    reuseInventory = false,
  ) =>
    Effect.gen(function* () {
      if (!reuseInventory) yield* inventories.invalidate(cwd);
      const status = yield* inventories.get(
        cwd,
        executeGit(
          "GitCore.readSourceControlFiles.status",
          cwd,
          ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
          { maxOutputBytes: 8_000_000, outputMode: "prefix", timeoutMs: 30_000 },
        ),
      );
      const inventory = sourceControlInventory(query);
      const records = status.stdout.split("\0");
      if (status.stdoutTruncated) records.pop();
      for (const record of records) inventory.accept(record);
      return inventory.result(status.stdoutTruncated === true);
    });

  const readWorkingTreePatch: GitCoreShape["readWorkingTreePatch"] = (cwd, filePath) =>
    Effect.gen(function* () {
      if (
        filePath !== undefined &&
        (!isWorkspaceRelativePathSafe(filePath) || filePath.includes("\0"))
      ) {
        return yield* createGitCommandError(
          "GitCore.readWorkingTreePatch.path",
          cwd,
          ["diff"],
          "File path must be a workspace-relative file path.",
        );
      }
      const headExists = yield* executeGit(
        "GitCore.readWorkingTreePatch.headExists",
        cwd,
        ["rev-parse", "--verify", "HEAD"],
        { allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));

      const paths: string[] = filePath === undefined ? [] : [filePath];
      let untrackedFiles: ReadonlyArray<string> | undefined;
      if (filePath !== undefined) {
        const isDirectory = yield* Effect.tryPromise({
          try: () =>
            nodeFs.lstat(nodePath.join(cwd, filePath)).then(
              (stat) => stat.isDirectory(),
              (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
                throw error;
              },
            ),
          catch: (cause) =>
            createGitCommandError(
              "GitCore.readWorkingTreePatch.path",
              cwd,
              ["diff"],
              String(cause),
            ),
        });
        const baseType = headExists
          ? yield* executeGit(
              "GitCore.readWorkingTreePatch.baseType",
              cwd,
              ["cat-file", "-t", `HEAD:${filePath}`],
              { allowNonZeroExit: true },
            )
          : null;
        if (isDirectory || baseType?.stdout.trim() === "tree") {
          return yield* createGitCommandError(
            "GitCore.readWorkingTreePatch.path",
            cwd,
            ["diff"],
            "A file diff cannot target a directory.",
          );
        }
        untrackedFiles = yield* listUntrackedFiles(
          cwd,
          "GitCore.readWorkingTreePatch",
          undefined,
          filePath,
        );

        if (headExists && baseType?.code !== 0 && !untrackedFiles.includes(filePath)) {
          let field = 0;
          let sourcePath = "";
          yield* executeGit(
            "GitCore.readWorkingTreePatch.renamePaths",
            cwd,
            ["diff", "--name-status", "-z", "--diff-filter=R", "--no-ext-diff", "HEAD"],
            {
              timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
              outputMode: "truncate",
              progress: {
                stdoutLineDelimiter: "\0",
                onStdoutLine: (record) =>
                  Effect.sync(() => {
                    if (field === 1) sourcePath = record;
                    if (field === 2 && record === filePath) paths.push(sourcePath);
                    field = (field + 1) % 3;
                  }),
              },
            },
          );
        }
      }

      const tracked = yield* executeGit(
        "GitCore.readWorkingTreePatch.trackedPatch",
        cwd,
        [
          "diff",
          "--patch",
          "--no-color",
          "--no-ext-diff",
          headExists ? "HEAD" : EMPTY_TREE_OBJECT_ID,
          ...(filePath === undefined ? [] : ["--", ...paths.map((path) => `:(literal)${path}`)]),
        ],
        {
          allowNonZeroExit: true,
          timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        },
      );

      const accumulator = makePatchAccumulator();
      appendPatchSegment(
        accumulator,
        tracked.stdout,
        tracked.stdoutTruncated === true,
        DEFAULT_MAX_OUTPUT_BYTES,
      );
      return yield* readUntrackedPatches(
        cwd,
        "GitCore.readWorkingTreePatch",
        accumulator,
        untrackedFiles,
      );
    });

  const readFileAtRev: GitCoreShape["readFileAtRev"] = (input) =>
    Effect.gen(function* () {
      const filePath = input.filePath.trim();
      if (!isWorkspaceRelativePathSafe(filePath)) {
        return yield* createGitCommandError(
          "GitCore.readFileAtRev",
          input.cwd,
          ["cat-file", "blob", filePath],
          "File path must be a workspace-relative path.",
        );
      }

      const maxBytes =
        input.encoding === "base64"
          ? Math.min(input.maxBytes ?? GIT_MEDIA_MAX_BYTES, GIT_MEDIA_MAX_BYTES)
          : Math.min(
              input.maxBytes ?? GIT_READ_FILE_AT_REV_MAX_BYTES,
              GIT_READ_FILE_AT_REV_MAX_BYTES,
            );

      if (input.base === "workingTree") {
        if (input.encoding !== "base64")
          return yield* createGitCommandError(
            "GitCore.readFileAtRev",
            input.cwd,
            ["read media"],
            "Working-tree media requires base64 encoding.",
          );
        return yield* commands.withPermit(readWorkingTreeMedia(input.cwd, filePath, maxBytes));
      }

      const baseRev =
        input.base === "index"
          ? null
          : input.base === "branch"
            ? yield* resolveBranchMergeBase(input.cwd)
            : input.rev?.trim() || "HEAD";

      const resolvedRev =
        baseRev === null
          ? "index"
          : yield* resolveCommitObjectId(input.cwd, baseRev, "GitCore.readFileAtRev.revParse");

      const blobRef = baseRev === null ? `:0:${filePath}` : `${resolvedRev}:${filePath}`;
      const sizeResult = yield* executeGit(
        "GitCore.readFileAtRev.size",
        input.cwd,
        ["cat-file", "-s", blobRef],
        { allowNonZeroExit: true },
      );
      if (sizeResult.code !== 0) {
        return { contents: "", resolvedRev, missing: true, truncated: false };
      }
      const blobSize = Number.parseInt(sizeResult.stdout.trim(), 10);
      const truncated = Number.isFinite(blobSize) && blobSize > maxBytes;

      if (input.encoding === "base64") {
        if (!Number.isSafeInteger(blobSize) || blobSize < 0 || truncated)
          return { contents: "", resolvedRev, missing: false, truncated: true };
        const contents = yield* commands.withPermit(
          readGitMedia(input.cwd, blobRef, blobSize).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        );
        return { contents, resolvedRev, missing: false, truncated: false };
      }

      const contents = yield* executeGit(
        "GitCore.readFileAtRev.blob",
        input.cwd,
        ["cat-file", "blob", blobRef],
        { maxOutputBytes: maxBytes, outputMode: "truncate" },
      ).pipe(Effect.map((result) => result.stdout));

      if (contents.includes("\u0000")) {
        return yield* createGitCommandError(
          "GitCore.readFileAtRev",
          input.cwd,
          ["cat-file", "blob", blobRef],
          "File at this revision appears to be binary.",
        );
      }

      return { contents, resolvedRev, missing: false, truncated };
    });

  const readBranchPatch: GitCoreShape["readBranchPatch"] = (cwd) =>
    Effect.gen(function* () {
      const mergeBase = yield* resolveBranchMergeBase(cwd);

      const tracked = yield* executeGit(
        "GitCore.readBranchPatch.trackedPatch",
        cwd,
        ["diff", "--patch", "--minimal", "--no-color", "--no-ext-diff", mergeBase],
        {
          timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
          maxOutputBytes: 10_000_000,
          outputMode: "truncate",
        },
      );
      const accumulator = makePatchAccumulator();
      appendPatchSegment(accumulator, tracked.stdout, tracked.stdoutTruncated === true, 10_000_000);
      return yield* readUntrackedPatches(
        cwd,
        "GitCore.readBranchPatch",
        accumulator,
        undefined,
        10_000_000,
      );
    });

  const resolveCommitObjectId = (cwd: string, rev: string, operation: string) =>
    Effect.gen(function* () {
      if (rev.startsWith("-")) {
        return yield* createGitCommandError(
          operation,
          cwd,
          ["rev-parse", "--verify", "--quiet", rev],
          `"${rev}" is not a valid revision.`,
        );
      }
      const verified = yield* executeGit(
        operation,
        cwd,
        ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`],
        { allowNonZeroExit: true },
      );
      const objectId = verified.stdout.trim();
      if (verified.code !== 0 || objectId.length === 0) {
        return yield* createGitCommandError(
          operation,
          cwd,
          ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`],
          `Cannot resolve "${rev}" to a commit in this repository.`,
        );
      }
      return objectId;
    });

  const blameLine: GitCoreShape["blameLine"] = (input) =>
    Effect.gen(function* () {
      // The revision comes from the client, so it is resolved to an object ID before it is placed on the
      // blame command line; an option-like value would otherwise be parsed as a blame flag rather than a
      // revision.
      const requestedRev = input.rev?.trim() ?? "";
      const resolvedRev =
        input.base === "branch"
          ? yield* resolveBranchMergeBase(input.cwd)
          : requestedRev.length === 0
            ? null
            : yield* resolveCommitObjectId(input.cwd, requestedRev, "GitCore.blameLine.revParse");
      const args = [
        "blame",
        "--porcelain",
        "-L",
        `${input.line},${input.line}`,
        ...(resolvedRev ? [resolvedRev] : []),
        "--",
        input.filePath,
      ];
      const result = yield* executeGit("GitCore.blameLine", input.cwd, args, {
        timeoutMs: BLAME_LINE_TIMEOUT_MS,
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        if (resolvedRev === null && /no such (?:path|ref)/i.test(result.stderr)) {
          return UNCOMMITTED_BLAME_RESULT;
        }
        return yield* createGitCommandError(
          "GitCore.blameLine",
          input.cwd,
          args,
          result.stderr.trim() || "git blame failed",
        );
      }

      const parsed = parseGitBlamePorcelain(result.stdout);
      if (!parsed) {
        return yield* createGitCommandError(
          "GitCore.blameLine",
          input.cwd,
          args,
          "git blame returned no attribution for this line.",
        );
      }
      return parsed;
    });

  const withRefIndex = <A>(
    cwd: string,
    resolvedRef: string,
    operationPrefix: string,
    use: (
      env: NodeJS.ProcessEnv,
      seededGitlinks: ReadonlySet<string>,
    ) => Effect.Effect<A, GitCommandError>,
  ): Effect.Effect<A, GitCommandError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempIndexDir = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: `glade-ref-index-${process.pid}-` })
          .pipe(
            Effect.mapError((cause) =>
              createGitCommandError(
                `${operationPrefix}.readTree`,
                cwd,
                ["read-tree", resolvedRef],
                cause.message,
              ),
            ),
          );
        const env = { GIT_INDEX_FILE: nodePath.join(tempIndexDir, "index") };
        yield* executeGit(`${operationPrefix}.readTree`, cwd, ["read-tree", resolvedRef], {
          env,
          fallbackErrorMessage: "git read-tree failed",
        });

        const additions = yield* executeGit(
          `${operationPrefix}.gitlinkAdditions`,
          cwd,
          [
            "diff",
            "--cached",
            "--raw",
            "--no-abbrev",
            "--no-renames",
            "--diff-filter=AMT",
            "-z",
            resolvedRef,
          ],
          { env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
        ).pipe(Effect.map((result) => result.stdout.split("\0")));
        const seededGitlinks = new Set<string>();
        for (let index = 0; index + 1 < additions.length; index += 2) {
          const entry = additions[index]?.split(" ");
          const filePath = additions[index + 1];
          const objectId = entry?.[3];
          if (entry?.[1] !== "160000" || !objectId || !filePath) continue;
          yield* executeGit(
            `${operationPrefix}.seedGitlink`,
            cwd,
            ["update-index", "--add", "--replace", "--cacheinfo", `160000,${objectId},${filePath}`],
            { env, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
          );
          seededGitlinks.add(filePath);
        }
        return yield* use(env, seededGitlinks);
      }),
    );

  const listWorkingTreeAdditionsAgainstRef = (
    cwd: string,
    resolvedRef: string,
    env: NodeJS.ProcessEnv,
    operationPrefix: string,
    seededGitlinks: ReadonlySet<string>,
  ) =>
    Effect.gen(function* () {
      const others = yield* listUntrackedFiles(cwd, operationPrefix, env);
      const trackedAdditions = yield* executeGit(
        `${operationPrefix}.trackedAdditions`,
        cwd,
        [
          "diff",
          "--name-only",
          "--no-renames",
          "--diff-filter=A",
          "-z",
          "--no-ext-diff",
          resolvedRef,
        ],
        { env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
      ).pipe(Effect.map((result) => result.stdout.split("\0").filter((entry) => entry.length > 0)));
      return [...new Set([...others, ...trackedAdditions])].filter(
        (filePath) => !seededGitlinks.has(filePath.replace(/\/$/, "")),
      );
    });

  const readRefPatch: GitCoreShape["readRefPatch"] = (cwd, ref) =>
    Effect.gen(function* () {
      const resolvedRef = yield* resolveCommitObjectId(cwd, ref, "GitCore.readRefPatch.verifyRef");

      return yield* withRefIndex(cwd, resolvedRef, "GitCore.readRefPatch", (env, seededGitlinks) =>
        Effect.gen(function* () {
          const tracked = yield* executeGit(
            "GitCore.readRefPatch.trackedPatch",
            cwd,
            ["diff", "--patch", "--no-color", "--no-ext-diff", resolvedRef],
            {
              env,
              timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
              maxOutputBytes: 10_000_000,
              outputMode: "truncate",
            },
          );
          const untrackedFiles = yield* listWorkingTreeAdditionsAgainstRef(
            cwd,
            resolvedRef,
            env,
            "GitCore.readRefPatch",
            seededGitlinks,
          );
          const accumulator = makePatchAccumulator();
          appendPatchSegment(
            accumulator,
            tracked.stdout,
            tracked.stdoutTruncated === true,
            10_000_000,
          );
          return yield* readUntrackedPatches(
            cwd,
            "GitCore.readRefPatch",
            accumulator,
            untrackedFiles,
            10_000_000,
          );
        }),
      );
    });

  const readDiffStats: GitCoreShape["readDiffStats"] = (cwd, scope, ref, includeUntrackedFiles) =>
    Effect.gen(function* () {
      let trackedArgs: ReadonlyArray<string>;
      let includeUntracked = false;
      switch (scope) {
        case "staged":
          trackedArgs = ["diff", "--cached", "--numstat", "-z", "--no-ext-diff"];
          break;
        case "unstaged":
          trackedArgs = ["diff", "--numstat", "-z", "--no-ext-diff"];
          includeUntracked = true;
          break;
        case "branch": {
          const mergeBase = yield* resolveBranchMergeBase(cwd);
          trackedArgs = ["diff", "--numstat", "-z", "--minimal", "--no-ext-diff", mergeBase];
          includeUntracked = true;
          break;
        }
        case "ref": {
          const compareRef = (ref ?? "").trim();
          const resolvedRef = yield* resolveCommitObjectId(
            cwd,
            compareRef,
            "GitCore.readDiffStats.verifyRef",
          );
          return yield* withRefIndex(
            cwd,
            resolvedRef,
            "GitCore.readDiffStats",
            (env, seededGitlinks) =>
              Effect.gen(function* () {
                const tracked = yield* executeGit(
                  "GitCore.readDiffStats.tracked",
                  cwd,
                  ["diff", "--numstat", "-z", "--no-ext-diff", resolvedRef],
                  { env, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS, maxOutputBytes: 10_000_000 },
                ).pipe(Effect.map((result) => result.stdout));
                const untracked = yield* readUntrackedNumstats(
                  cwd,
                  "GitCore.readDiffStats",
                  yield* listWorkingTreeAdditionsAgainstRef(
                    cwd,
                    resolvedRef,
                    env,
                    "GitCore.readDiffStats",
                    seededGitlinks,
                  ),
                );
                const totals = summarizeGitNumstatOutputs([tracked, untracked]);
                return {
                  additions: totals.insertions,
                  deletions: totals.deletions,
                  fileCount: totals.files.length,
                };
              }),
          );
        }
        case "workingTree":
        default: {
          const headExists = yield* executeGit(
            "GitCore.readDiffStats.headExists",
            cwd,
            ["rev-parse", "--verify", "HEAD"],
            { allowNonZeroExit: true },
          ).pipe(Effect.map((result) => result.code === 0));
          trackedArgs = [
            "diff",
            "--numstat",
            "-z",
            "--no-ext-diff",
            headExists ? "HEAD" : EMPTY_TREE_OBJECT_ID,
          ];
          includeUntracked = true;
        }
      }

      const tracked = yield* executeGit("GitCore.readDiffStats.tracked", cwd, trackedArgs, {
        timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS,
        maxOutputBytes: 10_000_000,
      }).pipe(Effect.map((result) => result.stdout));
      const untracked = includeUntracked
        ? yield* readUntrackedNumstats(cwd, "GitCore.readDiffStats")
        : "";
      const totals = summarizeGitNumstatOutputs([tracked, untracked]);
      return {
        additions: totals.insertions,
        deletions: totals.deletions,
        fileCount: totals.files.length,
        ...(scope === "unstaged" && includeUntrackedFiles
          ? { untrackedFiles: summarizeGitNumstatOutputs([untracked]).files }
          : {}),
      };
    });
  return {
    readWorkingTreePatch,
    readUnstagedPatch,
    readStagedPatch,
    readSourceControlFiles,
    readBranchPatch,
    blameLine,
    readFileAtRev,
    readRefPatch,
    readDiffStats,
  };
});

export const GitDiffLive = Layer.effect(GitDiff, makeGitDiff);
