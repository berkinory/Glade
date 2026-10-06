import { WorkspaceEntrySearch } from "./search/workspaceEntrySearch";
import { WorkspaceContentSearch } from "./WorkspaceContentSearch";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  filterGitIgnoredPaths,
  isInsideGitWorkTree,
  type WorkspaceGitRunner,
} from "./search/workspaceIndex";
import { getWorkspaceIndex, type CachedWorkspaceIndex } from "./search/workspaceIndexCache";
export {
  invalidateWorkspaceIndex,
  prewarmWorkspaceSearchIndex,
} from "./search/workspaceIndexCache";
export type { WorkspaceGitRunner } from "./search/workspaceIndex";

import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
} from "@glade/contracts/workspace/filesystem";
import {
  ProjectFileSystemEntry,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectLocalSearchEntry,
  ProjectResolveWorkspaceFileReferencesInput,
  ProjectResolveWorkspaceFileReferencesResult,
  ProjectSearchContentInput,
  ProjectSearchContentResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
} from "@glade/contracts/workspace/project";
import {
  isExplicitRelativePath,
  isWindowsAbsolutePath,
  isWorkspaceRelativePathSafe,
} from "@glade/shared/platform/path";
import { resolveRealPathWithinRoot } from "./realPathContainment";

const EXPLORER_EXCLUDED_NAMES = new Set([".git", ".svn", ".hg", ".jj", ".DS_Store", "Thumbs.db"]);

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function normalizeLocalSearchQuery(input: string): string {
  let query = input.trim();
  while (query.startsWith("@") || query.startsWith("/") || query.startsWith("./")) {
    query = query.startsWith("./") ? query.slice(2) : query.slice(1);
  }
  return query;
}

function expandHomePath(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveBrowseTarget(input: FilesystemBrowseInput): string {
  if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    throw new Error("Windows-style paths are only supported on Windows.");
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath));
  }

  if (!input.cwd) {
    throw new Error("Relative filesystem browse paths require a current project.");
  }

  return path.resolve(expandHomePath(input.cwd), input.partialPath);
}

export async function browseWorkspaceEntries(
  input: FilesystemBrowseInput,
): Promise<FilesystemBrowseResult> {
  const resolvedInputPath = resolveBrowseTarget(input);
  const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
  const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
  const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

  const dirents = await fs.readdir(parentPath, { withFileTypes: true });

  const showHidden = endsWithSeparator || prefix.startsWith(".");
  const lowerPrefix = prefix.toLowerCase();

  return {
    parentPath,
    entries: dirents
      .filter(
        (dirent) =>
          dirent.isDirectory() &&
          dirent.name.toLowerCase().startsWith(lowerPrefix) &&
          (showHidden || !dirent.name.startsWith(".")),
      )
      .map((dirent) => ({
        name: dirent.name,
        fullPath: path.join(parentPath, dirent.name),
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function searchWorkspaceEntries(
  input: ProjectSearchEntriesInput,
  runGit: WorkspaceGitRunner,
): Promise<ProjectSearchEntriesResult> {
  const index = await getWorkspaceIndex(input.cwd, runGit);
  const result = index.search.search(input.query, input.limit, input.kind);
  return {
    ...result,
    truncated: index.truncated || result.truncated,
  };
}

const contentSearch = new WorkspaceContentSearch();

export function searchWorkspaceContent(
  input: ProjectSearchContentInput,
  runGit: WorkspaceGitRunner,
  signal?: AbortSignal,
): Promise<ProjectSearchContentResult> {
  return contentSearch.search(input, () => getWorkspaceIndex(input.cwd, runGit), signal);
}

function normalizedWorkspaceFileReference(reference: string): string | null {
  const trimmed = reference.trim();
  if (!isWorkspaceRelativePathSafe(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(toPosixPath(trimmed)).replace(/^\.\/+/, "");
  return normalized.length > 0 && normalized !== "." ? normalized : null;
}

const pathsByBasenameByIndex = new WeakMap<
  CachedWorkspaceIndex,
  ReadonlyMap<string, ReadonlyArray<string>>
>();

function filePathsByBasename(
  index: CachedWorkspaceIndex,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const cached = pathsByBasenameByIndex.get(index);
  if (cached) {
    return cached;
  }
  const built = buildFilePathsByBasename(index);
  pathsByBasenameByIndex.set(index, built);
  return built;
}

function buildFilePathsByBasename(
  index: CachedWorkspaceIndex,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const pathsByBasename = new Map<string, string[]>();
  for (const entry of index.entries) {
    if (entry.kind !== "file") {
      continue;
    }
    const basename = path.posix.basename(entry.path);
    const paths = pathsByBasename.get(basename);
    if (paths) {
      paths.push(entry.path);
    } else {
      pathsByBasename.set(basename, [entry.path]);
    }
  }
  return pathsByBasename;
}

function resolveWorkspaceFileReferenceFromIndex(
  reference: string,
  pathsByBasename: ReadonlyMap<string, ReadonlyArray<string>>,
): string | null {
  const normalized = normalizedWorkspaceFileReference(reference);
  if (!normalized) {
    return null;
  }
  const candidates = pathsByBasename.get(path.posix.basename(normalized)) ?? [];
  const suffix = `/${normalized}`;
  let match: string | null = null;
  for (const candidate of candidates) {
    if (candidate !== normalized && !candidate.endsWith(suffix)) {
      continue;
    }
    if (match !== null) {
      return null;
    }
    match = candidate;
  }
  return match;
}

export async function resolveWorkspaceFileReferences(
  input: ProjectResolveWorkspaceFileReferencesInput,
  runGit: WorkspaceGitRunner,
): Promise<ProjectResolveWorkspaceFileReferencesResult> {
  const index = await getWorkspaceIndex(input.cwd, runGit);
  const pathsByBasename = filePathsByBasename(index);
  return {
    relativePaths: input.relativePaths.map((reference) =>
      resolveWorkspaceFileReferenceFromIndex(reference, pathsByBasename),
    ),
  };
}

export async function resolveWorkspaceFileBySuffix(
  input: {
    cwd: string;
    relativePath: string;
  },
  runGit: WorkspaceGitRunner,
): Promise<string | null> {
  const result = await resolveWorkspaceFileReferences(
    {
      cwd: input.cwd,
      relativePaths: [input.relativePath],
    },
    runGit,
  );
  return result.relativePaths[0] ?? null;
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

function resolveDirectoryWithinRoot(cwd: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || isWindowsAbsolutePath(relativePath)) {
    throw new Error("Directory path is outside the workspace root.");
  }
  const absolutePath = path.resolve(cwd, relativePath);
  const relativeToRoot = path.relative(cwd, absolutePath);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Directory path is outside the workspace root.");
  }
  return absolutePath;
}

export async function listWorkspaceDirectories(
  input: ProjectListDirectoriesInput,
  runGit: WorkspaceGitRunner,
): Promise<ProjectListDirectoriesResult> {
  const relativePath = input.relativePath?.trim() ?? "";
  const resolvedTarget = relativePath
    ? resolveDirectoryWithinRoot(input.cwd, relativePath)
    : input.cwd;

  const targetDirectory = await resolveRealPathWithinRoot(input.cwd, resolvedTarget);
  if (targetDirectory === null) {
    throw new Error("Directory path is outside the workspace root.");
  }
  const dirents = await fs.readdir(targetDirectory, { withFileTypes: true });
  const entries = dirents
    .filter(
      (dirent) =>
        dirent.name.length > 0 &&
        dirent.name !== "." &&
        dirent.name !== ".." &&
        !EXPLORER_EXCLUDED_NAMES.has(dirent.name) &&
        (dirent.isDirectory() || (input.includeFiles === true && dirent.isFile())),
    )
    .toSorted((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map(
      (dirent): ProjectFileSystemEntry => ({
        path: toPosixPath(relativePath ? path.join(relativePath, dirent.name) : dirent.name),
        name: dirent.name,
        kind: dirent.isDirectory() ? "directory" : "file",
        ...(relativePath ? { parentPath: relativePath } : {}),
      }),
    );

  const visiblePaths = (await isInsideGitWorkTree(input.cwd, runGit))
    ? new Set(
        await filterGitIgnoredPaths(
          input.cwd,
          entries.map((entry) => entry.path),
          runGit,
          { respectIndex: true },
        ),
      )
    : null;
  return {
    entries: entries.map((entry) => ({
      ...entry,
      ...(visiblePaths && !visiblePaths.has(entry.path) ? { isGitIgnored: true } : {}),
    })),
  };
}

const LOCAL_SEARCH_MAX_DEPTH = 6;
const LOCAL_SEARCH_DEFAULT_LIMIT = 50;
const LOCAL_SEARCH_TIME_BUDGET_MS = 600;
const LOCAL_SEARCH_READDIR_CONCURRENCY = 16;

const LOCAL_SEARCH_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".Trash",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".convex",
  ".pnpm-store",
  ".yarn",
  ".gradle",
  ".m2",
  ".nuget",
  ".bundle",
  "Library",
  "Pods",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

export async function searchLocalEntries(
  input: ProjectSearchLocalEntriesInput,
): Promise<ProjectSearchLocalEntriesResult> {
  const normalizedQuery = normalizeLocalSearchQuery(input.query);
  if (normalizedQuery.length === 0) {
    return { entries: [], truncated: false };
  }

  const limit = Math.max(
    1,
    Math.min(input.limit ?? LOCAL_SEARCH_DEFAULT_LIMIT, LOCAL_SEARCH_DEFAULT_LIMIT),
  );
  const includeFiles = input.includeFiles !== false;
  // When the user explicitly searches for a dotfile prefix (`.ss`, `.en`) surface hidden entries;
  // otherwise skip them so the walk is bounded and predictable.
  const includeDotfiles = normalizedQuery.startsWith(".");
  const deadline = Date.now() + LOCAL_SEARCH_TIME_BUDGET_MS;

  const candidates: ProjectLocalSearchEntry[] = [];
  let truncated = false;
  let currentLevel: Array<{ absolutePath: string; depth: number }> = [
    { absolutePath: input.rootPath, depth: 0 },
  ];

  while (currentLevel.length > 0) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }

    const nextLevel: Array<{ absolutePath: string; depth: number }> = [];
    await mapWithConcurrency(
      currentLevel,
      LOCAL_SEARCH_READDIR_CONCURRENCY,
      async ({ absolutePath, depth }) => {
        if (Date.now() > deadline || candidates.length >= 100_000) return;
        let dirents: Dirent[];
        try {
          dirents = await fs.readdir(absolutePath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const dirent of dirents) {
          const name = dirent.name;
          if (!name || name === "." || name === "..") continue;
          if (LOCAL_SEARCH_IGNORED_DIRECTORY_NAMES.has(name)) continue;
          if (!includeDotfiles && name.startsWith(".")) continue;

          const isDirectory = dirent.isDirectory();
          const isFile = dirent.isFile();
          if (!isDirectory && !isFile) continue;
          if (!includeFiles && !isDirectory) continue;

          const childAbsolutePath = path.join(absolutePath, name);

          candidates.push({
            path: childAbsolutePath,
            name,
            kind: isDirectory ? "directory" : "file",
            parentPath: absolutePath,
          });
          if (candidates.length >= 100_000) {
            truncated = true;
            break;
          }

          if (isDirectory && depth + 1 < LOCAL_SEARCH_MAX_DEPTH) {
            nextLevel.push({ absolutePath: childAbsolutePath, depth: depth + 1 });
          }
        }
      },
    );

    if (candidates.length >= 100_000) break;
    currentLevel = nextLevel;
  }

  const originals = new Map(candidates.map((entry) => [entry.path, entry]));
  const result = new WorkspaceEntrySearch(candidates, false).search(normalizedQuery, limit);
  return {
    entries: result.entries.map((entry) => originals.get(entry.path)!),
    truncated: truncated || result.truncated,
  };
}
