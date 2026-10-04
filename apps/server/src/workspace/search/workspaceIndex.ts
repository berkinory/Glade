import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { ProjectEntry } from "@glade/contracts/workspace/project";
import type { ProcessRunOptions, ProcessRunResult } from "../../platform/processRunner";

export interface WorkspaceGitRunner {
  (args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
}
export interface WorkspaceIndex {
  scannedAt: number;
  entries: ProjectEntry[];
  truncated: boolean;
}
const WORKSPACE_INDEX_MAX_FILES = 100_000;
const WORKSPACE_INDEX_MAX_DIRECTORIES = 25_000;
const WORKSPACE_SCAN_MAX_DIRECTORIES = 100_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const WORKSPACE_GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from({ length: items.length }) as TOutput[];
  let nextIndex = 0;

  const workers = Array.from({ length: boundedConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex] as TInput, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function isInsideGitWorkTree(
  cwd: string,
  runGit: WorkspaceGitRunner,
): Promise<boolean> {
  const insideWorkTree = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd,
    allowNonZeroExit: true,
    timeoutMs: 5_000,
    maxBufferBytes: 4_096,
  }).catch(() => null);
  return Boolean(
    insideWorkTree && insideWorkTree.code === 0 && insideWorkTree.stdout.trim() === "true",
  );
}

export async function filterGitIgnoredPaths(
  cwd: string,
  relativePaths: string[],
  runGit: WorkspaceGitRunner,
  options?: { respectIndex: boolean },
): Promise<string[]> {
  if (relativePaths.length === 0) {
    return relativePaths;
  }

  const ignoredPaths = new Set<string>();
  let chunk: string[] = [];
  let chunkBytes = 0;

  const flushChunk = async (): Promise<void> => {
    if (chunk.length === 0) {
      return;
    }

    const checkIgnore = await runGit(
      [
        ...WORKSPACE_GIT_HARDENED_CONFIG_ARGS,
        "check-ignore",
        ...(options?.respectIndex ? [] : ["--no-index"]),
        "-z",
        "--stdin",
      ],
      {
        cwd,
        allowNonZeroExit: true,
        timeoutMs: 20_000,
        maxBufferBytes: 16 * 1024 * 1024,
        outputMode: "truncate",
        stdin: `${chunk.join("\0")}\0`,
      },
    ).catch(() => null);
    chunk = [];
    chunkBytes = 0;

    if (!checkIgnore || checkIgnore.stdoutTruncated) {
      throw new Error("Unable to evaluate workspace Git ignore rules.");
    }

    if (checkIgnore.code !== 0 && checkIgnore.code !== 1) {
      throw new Error("Unable to evaluate workspace Git ignore rules.");
    }

    const matchedIgnoredPaths = splitNullSeparatedPaths(
      checkIgnore.stdout,
      Boolean(checkIgnore.stdoutTruncated),
    );
    for (const ignoredPath of matchedIgnoredPaths) {
      ignoredPaths.add(ignoredPath);
    }
  };

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (chunk.length > 0 && chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      await flushChunk();
    }
    chunk.push(relativePath);
    chunkBytes += relativePathBytes;
    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES) await flushChunk();
  }
  await flushChunk();

  if (ignoredPaths.size === 0) {
    return relativePaths;
  }

  return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
}

async function buildWorkspaceIndexFromGit(
  cwd: string,
  runGit: WorkspaceGitRunner,
): Promise<WorkspaceIndex | null> {
  if (!(await isInsideGitWorkTree(cwd, runGit))) {
    return null;
  }

  const listedFiles = await runGit(
    [
      ...WORKSPACE_GIT_HARDENED_CONFIG_ARGS,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
    },
  ).catch(() => null);
  if (!listedFiles || listedFiles.code !== 0) {
    return null;
  }

  const deletedFiles = await runGit(
    [...WORKSPACE_GIT_HARDENED_CONFIG_ARGS, "ls-files", "--deleted", "-z"],
    {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
    },
  ).catch(() => null);
  // An incomplete exclusion set could resurrect missing paths; use the filesystem instead.
  if (
    !deletedFiles ||
    deletedFiles.code !== 0 ||
    deletedFiles.stdoutTruncated ||
    (deletedFiles.stdout.length > 0 && !deletedFiles.stdout.endsWith("\0"))
  )
    return null;
  const deletedPaths = new Set(
    splitNullSeparatedPaths(deletedFiles.stdout, false).map(toPosixPath),
  );

  const listedPaths = splitNullSeparatedPaths(
    listedFiles.stdout,
    Boolean(listedFiles.stdoutTruncated),
  )
    .map((entry) => toPosixPath(entry))
    .filter(
      (entry) =>
        entry.length > 0 &&
        !deletedPaths.has(entry) &&
        !isPathInIgnoredDirectory(parentPathOf(entry) ?? ""),
    );
  const filePaths = await filterGitIgnoredPaths(cwd, listedPaths, runGit);

  const uniqueFiles = [...new Set(filePaths)];
  const files = uniqueFiles.slice(0, WORKSPACE_INDEX_MAX_FILES);
  const entries: ProjectEntry[] = files.map((filePath) => ({
    path: filePath,
    kind: "file",
    parentPath: parentPathOf(filePath),
  }));
  const directorySet = new Set<string>();
  for (const filePath of files) {
    let parent = parentPathOf(filePath);
    while (parent && !directorySet.has(parent)) {
      directorySet.add(parent);
      parent = parentPathOf(parent);
    }
  }
  let emittedDirectories = 0;
  for (const directoryPath of directorySet) {
    if (emittedDirectories >= WORKSPACE_INDEX_MAX_DIRECTORIES) break;
    entries.push({
      path: directoryPath,
      kind: "directory",
      parentPath: parentPathOf(directoryPath),
    });
    emittedDirectories++;
  }
  return {
    scannedAt: Date.now(),
    entries,
    truncated:
      Boolean(listedFiles.stdoutTruncated) ||
      uniqueFiles.length > files.length ||
      directorySet.size > WORKSPACE_INDEX_MAX_DIRECTORIES,
  };
}

export async function buildWorkspaceIndex(
  cwd: string,
  runGit: WorkspaceGitRunner,
): Promise<WorkspaceIndex> {
  const gitIndexed = await buildWorkspaceIndexFromGit(cwd, runGit);
  if (gitIndexed) {
    return gitIndexed;
  }
  const shouldFilterWithGitIgnore = await isInsideGitWorkTree(cwd, runGit);

  let pendingDirectories: string[] = [""];
  const entries: ProjectEntry[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let truncated = false;

  while (pendingDirectories.length > 0 && fileCount <= WORKSPACE_INDEX_MAX_FILES) {
    const currentDirectories = pendingDirectories;
    pendingDirectories = [];
    const directoryEntries = await mapWithConcurrency(
      currentDirectories,
      WORKSPACE_SCAN_READDIR_CONCURRENCY,
      async (relativeDir) => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        try {
          const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
          return { relativeDir, dirents };
        } catch (error) {
          if (!relativeDir) {
            throw new Error(
              `Unable to scan workspace entries at '${cwd}': ${error instanceof Error ? error.message : "unknown error"}`,
              { cause: error },
            );
          }
          return { relativeDir, dirents: null };
        }
      },
    );

    const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
      const { relativeDir, dirents } = directoryEntry;
      if (!dirents) {
        truncated = true;
        return [] as Array<{ dirent: Dirent; relativePath: string }>;
      }

      dirents.sort((left, right) => left.name.localeCompare(right.name));
      const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
      for (const dirent of dirents) {
        if (!dirent.name || dirent.name === "." || dirent.name === "..") {
          continue;
        }
        if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
          continue;
        }
        if (!dirent.isDirectory() && !dirent.isFile()) {
          continue;
        }

        const relativePath = toPosixPath(
          relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
        );
        if (isPathInIgnoredDirectory(dirent.isDirectory() ? relativePath : relativeDir)) {
          continue;
        }
        candidates.push({ dirent, relativePath });
      }
      return candidates;
    });

    const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
      candidateEntries.map((entry) => entry.relativePath),
    );
    const allowedPathSet = shouldFilterWithGitIgnore
      ? new Set(await filterGitIgnoredPaths(cwd, candidatePaths, runGit))
      : null;

    for (const candidateEntries of candidateEntriesByDirectory) {
      for (const candidate of candidateEntries) {
        if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
          continue;
        }

        const entry: ProjectEntry = {
          path: candidate.relativePath,
          kind: candidate.dirent.isDirectory() ? "directory" : "file",
          parentPath: parentPathOf(candidate.relativePath),
        };
        if (entry.kind === "directory") {
          directoryCount++;
          if (directoryCount <= WORKSPACE_SCAN_MAX_DIRECTORIES)
            pendingDirectories.push(candidate.relativePath);
          else truncated = true;
          if (directoryCount > WORKSPACE_INDEX_MAX_DIRECTORIES) {
            truncated = true;
            continue;
          }
        } else if (++fileCount > WORKSPACE_INDEX_MAX_FILES) {
          truncated = true;
          break;
        }
        entries.push(entry);
      }

      if (fileCount > WORKSPACE_INDEX_MAX_FILES) break;
    }
  }

  return {
    scannedAt: Date.now(),
    entries,
    truncated,
  };
}
