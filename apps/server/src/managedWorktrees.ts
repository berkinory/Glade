import { normalizeOperationError, type TaggedFailure } from "./platform/operationError.ts";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ServerManagedWorktree } from "@glade/contracts/server/server";
import { Effect } from "effect";

import type { GitCoreShape } from "./git/Services/GitCore.ts";
import type { ProjectionSnapshotQueryShape } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

class ManagedWorktreeError extends Error {
  readonly _tag = "ManagedWorktreeError";
}

const MANAGED_WORKTREE_SCAN_DEPTH = 6;
export const MANAGED_WORKTREE_RETENTION_COUNT = 15;

export const MANAGED_WORKTREE_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SNAPSHOT_MANIFEST_FILENAME = "snapshot.json";

const SNAPSHOT_STAGING_DIR_PATTERN = /\.tmp-[A-Za-z0-9]+$/u;

export function managedWorktreeSnapshotsDir(homeDir: string): string {
  return path.join(homeDir, "worktree-snapshots");
}

export function isManagedWorktreePath(input: {
  readonly worktreesDir: string;
  readonly worktreePath: string;
}): boolean {
  const relative = path.relative(
    path.resolve(input.worktreesDir),
    path.resolve(input.worktreePath),
  );
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

export function isManagedWorktreePathCanonical(input: {
  readonly worktreesDir: string;
  readonly worktreePath: string;
}): Effect.Effect<boolean, TaggedFailure> {
  return Effect.tryPromise({
    try: async () =>
      isManagedWorktreePath({
        worktreesDir: await fs.realpath(input.worktreesDir),
        worktreePath: await canonicalizeRemovedPath(input.worktreePath),
      }),
    catch: (cause) => normalizeOperationError(cause),
  });
}

export function archivedWorktreeHasNoOtherOwners(input: {
  readonly worktreePath: string;
  readonly threadId: string;
  readonly threads: ReadonlyArray<ManagedWorktreeThreadRef>;
}): Effect.Effect<boolean, TaggedFailure> {
  return Effect.tryPromise({
    try: async () => {
      const target = await fs.realpath(input.worktreePath);
      let targetOwnsPath = false;
      for (const thread of input.threads) {
        for (const recorded of [thread.worktreePath, thread.associatedWorktreePath]) {
          if (!recorded) continue;
          if ((await canonicalizeRemovedPath(recorded)) !== target) continue;
          if (thread.id !== input.threadId) return false;
          targetOwnsPath = true;
        }
      }
      return targetOwnsPath;
    },
    catch: (cause) => normalizeOperationError(cause),
  });
}

export interface ManagedWorktreeThreadRef {
  readonly id: string;

  readonly archivedAt?: string | null | undefined;
  readonly deletedAt?: string | null | undefined;
  readonly worktreePath?: string | null | undefined;
  readonly associatedWorktreePath?: string | null | undefined;
}

type ManagedWorktreeRemovalReason = "deleted" | "archived-retention";

export interface ManagedWorktreeRemovalCandidate {
  readonly entry: ServerManagedWorktree;
  readonly thread: ManagedWorktreeThreadRef;
  readonly reason: ManagedWorktreeRemovalReason;
}

async function findLinkedWorktreeRoots(root: string, current = root, depth = 0): Promise<string[]> {
  if (depth > MANAGED_WORKTREE_SCAN_DEPTH) return [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  if (entries.some((entry) => entry.name === ".git" && entry.isFile())) {
    return [await fs.realpath(current)];
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => findLinkedWorktreeRoots(root, path.join(current, entry.name), depth + 1)),
  );
  return nested.flat();
}

function parsePrimaryWorktreePath(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      const value = line.slice("worktree ".length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export function listManagedWorktrees(input: {
  readonly worktreesDir: string;
  readonly git: GitCoreShape;
}): Effect.Effect<ReadonlyArray<ServerManagedWorktree>, TaggedFailure> {
  return Effect.tryPromise({
    try: () => findLinkedWorktreeRoots(input.worktreesDir),
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.flatMap((worktreePaths) =>
      Effect.forEach(
        worktreePaths,
        (worktreePath) =>
          input.git
            .execute({
              operation: "ManagedWorktrees.list",
              cwd: worktreePath,
              args: ["worktree", "list", "--porcelain"],
              timeoutMs: 5_000,
            })
            .pipe(
              Effect.flatMap((result) => {
                const workspaceRoot = parsePrimaryWorktreePath(result.stdout);
                return workspaceRoot
                  ? Effect.succeed({ path: worktreePath, workspaceRoot })
                  : Effect.fail(
                      new ManagedWorktreeError(
                        `Git did not report a primary worktree for ${worktreePath}.`,
                      ),
                    );
              }),
              Effect.catch((error) =>
                Effect.logWarning("managed worktree inventory skipped an invalid entry", {
                  worktreePath,
                  error: error instanceof Error ? error.message : String(error),
                }).pipe(Effect.as(null)),
              ),
            ),
        { concurrency: 4 },
      ),
    ),
    Effect.map((entries) =>
      entries
        .filter((entry): entry is ServerManagedWorktree => entry !== null)
        .sort((left, right) => left.path.localeCompare(right.path)),
    ),
  );
}

function threadManagedWorktreePath(thread: ManagedWorktreeThreadRef): string | null {
  return thread.associatedWorktreePath ?? thread.worktreePath ?? null;
}

function isActiveManagedWorktreeThread(thread: ManagedWorktreeThreadRef): boolean {
  return (thread.deletedAt ?? null) === null && (thread.archivedAt ?? null) === null;
}

function isDeletedManagedWorktreeThread(thread: ManagedWorktreeThreadRef): boolean {
  return (thread.deletedAt ?? null) !== null;
}

function isArchivedOnlyManagedWorktreeThread(thread: ManagedWorktreeThreadRef): boolean {
  return !isDeletedManagedWorktreeThread(thread) && (thread.archivedAt ?? null) !== null;
}

function canonicalizeThreadWorktreePaths(
  threads: ReadonlyArray<ManagedWorktreeThreadRef>,
): Effect.Effect<ReadonlyMap<string, string>, TaggedFailure> {
  return Effect.tryPromise({
    try: async () => {
      const canonicalByRecordedPath = new Map<string, string>();
      for (const thread of threads) {
        const recordedPath = threadManagedWorktreePath(thread);
        if (recordedPath === null || canonicalByRecordedPath.has(recordedPath)) continue;
        canonicalByRecordedPath.set(
          recordedPath,
          await fs.realpath(recordedPath).catch(() => path.resolve(recordedPath)),
        );
      }
      return canonicalByRecordedPath;
    },
    catch: (cause) => normalizeOperationError(cause),
  });
}

function snapshotDigestForWorktreePath(worktreePath: string): string {
  return createHash("sha256").update(worktreePath).digest("hex").slice(0, 12);
}

function snapshotOutputPath(input: {
  readonly snapshotsDir: string;
  readonly threadId: string;
  readonly worktreePath: string;
}): string {
  const digest = snapshotDigestForWorktreePath(input.worktreePath);
  const threadPathSegment = input.threadId
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return path.join(input.snapshotsDir, `${threadPathSegment || "thread"}-${digest}`);
}

// Active owners are never reclaim candidates.
export function classifyManagedWorktreeRemovalCandidates(input: {
  readonly inventory: ReadonlyArray<ServerManagedWorktree>;
  readonly threads: ReadonlyArray<ManagedWorktreeThreadRef>;
  readonly canonicalByRecordedPath: ReadonlyMap<string, string>;
}): ReadonlyArray<ManagedWorktreeRemovalCandidate> {
  const canonicalThreadPath = (thread: ManagedWorktreeThreadRef): string | null => {
    const recordedPath = threadManagedWorktreePath(thread);
    return recordedPath === null ? null : (input.canonicalByRecordedPath.get(recordedPath) ?? null);
  };
  const inventoryByPath = new Map(input.inventory.map((entry) => [entry.path, entry]));

  const activePaths = new Set<string>();
  for (const thread of input.threads) {
    if (!isActiveManagedWorktreeThread(thread)) continue;
    const worktreePath = canonicalThreadPath(thread);
    if (worktreePath !== null) activePaths.add(worktreePath);
  }

  const deletedCandidates: ManagedWorktreeRemovalCandidate[] = [];
  const seenDeletedPaths = new Set<string>();
  for (const thread of input.threads) {
    if (!isDeletedManagedWorktreeThread(thread)) continue;
    const worktreePath = canonicalThreadPath(thread);
    if (
      worktreePath === null ||
      activePaths.has(worktreePath) ||
      seenDeletedPaths.has(worktreePath)
    ) {
      continue;
    }
    const entry = inventoryByPath.get(worktreePath);
    if (!entry) continue;
    seenDeletedPaths.add(worktreePath);
    deletedCandidates.push({ entry, thread, reason: "deleted" });
  }

  const seenArchivedPaths = new Set<string>();
  const archivedKeepers = input.threads
    .filter(isArchivedOnlyManagedWorktreeThread)
    .map((thread) => {
      const worktreePath = canonicalThreadPath(thread);
      return worktreePath
        ? { thread, entry: inventoryByPath.get(worktreePath) ?? null }
        : { thread, entry: null };
    })
    .filter(
      (value): value is { thread: ManagedWorktreeThreadRef; entry: ServerManagedWorktree } =>
        value.entry !== null &&
        !activePaths.has(value.entry.path) &&
        !seenDeletedPaths.has(value.entry.path),
    )
    .toSorted((left, right) =>
      (right.thread.archivedAt ?? "").localeCompare(left.thread.archivedAt ?? ""),
    )
    .filter(({ entry }) => {
      if (seenArchivedPaths.has(entry.path)) return false;
      seenArchivedPaths.add(entry.path);
      return true;
    });

  const archivedRetentionCandidates = archivedKeepers.slice(MANAGED_WORKTREE_RETENTION_COUNT).map(
    ({ thread, entry }): ManagedWorktreeRemovalCandidate => ({
      entry,
      thread,
      reason: "archived-retention",
    }),
  );

  return [...deletedCandidates, ...archivedRetentionCandidates];
}

const ensureSnapshotsDir = (snapshotsDir: string) =>
  Effect.tryPromise({
    try: () => fs.mkdir(snapshotsDir, { recursive: true, mode: 0o700 }),
    catch: (cause) => normalizeOperationError(cause),
  });

const snapshotExists = (snapshotPath: string) =>
  Effect.tryPromise({
    try: () =>
      fs
        .stat(path.join(snapshotPath, SNAPSHOT_MANIFEST_FILENAME))
        .then((entry) => entry.isFile())
        .catch((cause: unknown) => {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw cause;
        }),
    catch: (cause) => normalizeOperationError(cause),
  });

function removeManagedWorktreeSafely(input: {
  readonly worktreesDir: string;
  readonly snapshotsDir: string;
  readonly candidate: ManagedWorktreeRemovalCandidate;
  readonly git: GitCoreShape;
}): Effect.Effect<boolean, TaggedFailure> {
  const { entry, thread, reason } = input.candidate;
  const snapshotPath = snapshotOutputPath({
    snapshotsDir: input.snapshotsDir,
    threadId: thread.id,
    worktreePath: entry.path,
  });

  return input.git
    .withMutation(
      entry.workspaceRoot,
      Effect.gen(function* () {
        const alreadySnapshotted = yield* snapshotExists(snapshotPath);
        if (!alreadySnapshotted) {
          yield* input.git.snapshotWorktree({ cwd: entry.path, outputPath: snapshotPath });
        }

        const status = yield* input.git.statusDetails(entry.path).pipe(
          Effect.catch((error) =>
            Effect.logWarning("managed worktree cleanup could not read dirty state", {
              threadId: thread.id,
              worktreePath: entry.path,
              reason,
              error: error instanceof Error ? error.message : String(error),
            }).pipe(Effect.as(null)),
          ),
        );
        if (status?.hasWorkingTreeChanges) {
          yield* Effect.logWarning(
            "managed worktree cleanup skipped dirty worktree; refusing silent data loss",
            {
              threadId: thread.id,
              worktreePath: entry.path,
              reason,
              branch: status.branch,
            },
          );
          return false;
        }

        yield* input.git.removeWorktree({
          cwd: entry.workspaceRoot,
          path: entry.path,
          force: false,
          reclaimTemporaryBranch: true,
        });

        yield* discardEmptyManagedWorktreeParent({
          worktreesDir: input.worktreesDir,
          worktreePath: entry.path,
        });
        return true;
      }),
    )
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning("managed worktree retention skipped an unsafe cleanup", {
          threadId: thread.id,
          worktreePath: entry.path,
          reason,
          error: error instanceof Error ? error.message : String(error),
        }).pipe(Effect.as(false)),
      ),
    );
}

export function pruneArchivedManagedWorktrees(input: {
  readonly worktreesDir: string;
  readonly snapshotsDir: string;
  readonly threads: ReadonlyArray<ManagedWorktreeThreadRef>;
  readonly git: GitCoreShape;
}): Effect.Effect<ReadonlyArray<ServerManagedWorktree>, TaggedFailure> {
  return Effect.gen(function* () {
    const inventory = yield* listManagedWorktrees(input);
    const canonicalByRecordedPath = yield* canonicalizeThreadWorktreePaths(input.threads);
    const removalCandidates = classifyManagedWorktreeRemovalCandidates({
      inventory,
      threads: input.threads,
      canonicalByRecordedPath,
    });
    const removedPaths = new Set<string>();
    if (removalCandidates.length > 0) {
      yield* ensureSnapshotsDir(input.snapshotsDir);
      yield* Effect.forEach(
        removalCandidates,
        (candidate) =>
          removeManagedWorktreeSafely({
            worktreesDir: input.worktreesDir,
            snapshotsDir: input.snapshotsDir,
            candidate,
            git: input.git,
          }).pipe(
            Effect.tap((removed) =>
              removed ? Effect.sync(() => removedPaths.add(candidate.entry.path)) : Effect.void,
            ),
          ),
        { discard: true, concurrency: 1 },
      );
    }

    yield* pruneExpiredManagedWorktreeSnapshots({ snapshotsDir: input.snapshotsDir });
    return inventory.filter((entry) => !removedPaths.has(entry.path));
  });
}

export function pruneProjectedArchivedManagedWorktrees(input: {
  readonly homeDir: string;
  readonly worktreesDir: string;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly git: GitCoreShape;
}): Effect.Effect<ReadonlyArray<ServerManagedWorktree>, TaggedFailure> {
  return Effect.gen(function* () {
    const threads = yield* input.snapshotQuery.listManagedWorktreeThreads();
    return yield* pruneArchivedManagedWorktrees({
      worktreesDir: input.worktreesDir,
      snapshotsDir: managedWorktreeSnapshotsDir(input.homeDir),
      threads,
      git: input.git,
    });
  });
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const isMissingPathError = (cause: unknown) =>
  (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

async function listSnapshotDirectories(snapshotsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(snapshotsDir, entry.name));
  } catch (cause) {
    if (isMissingPathError(cause)) return [];
    throw cause;
  }
}

async function readSnapshotManifest(
  snapshotPath: string,
): Promise<{ readonly sourceWorktree?: unknown; readonly createdAt?: unknown } | null> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(snapshotPath, SNAPSHOT_MANIFEST_FILENAME), "utf8"),
    );
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function canonicalizeRemovedPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  return fs
    .realpath(resolved)
    .catch(() =>
      fs
        .realpath(path.dirname(resolved))
        .then((parent) => path.join(parent, path.basename(resolved))),
    )
    .catch(() => resolved);
}

export function discardEmptyManagedWorktreeParent(input: {
  readonly worktreesDir: string;
  readonly worktreePath: string;
}): Effect.Effect<void, never> {
  return Effect.tryPromise({
    try: async () => {
      const parent = path.dirname(path.resolve(input.worktreePath));
      const [canonicalWorktreesDir, canonicalGrandparent] = await Promise.all([
        canonicalizeRemovedPath(input.worktreesDir),
        canonicalizeRemovedPath(path.dirname(parent)),
      ]);
      if (canonicalGrandparent !== canonicalWorktreesDir) return;
      let entries: string[];
      try {
        entries = await fs.readdir(parent);
      } catch (cause) {
        if (isMissingPathError(cause)) return;
        throw cause;
      }
      if (entries.length > 0) return;
      // rmdir refuses a non-empty directory, so a worktree created here since the readdir above cannot be
      // lost.
      await fs.rmdir(parent);
    },
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("managed worktree cleanup could not remove its empty parent folder", {
        worktreePath: input.worktreePath,
        error: errorMessage(cause),
      }),
    ),
  );
}

export function discardManagedWorktreeResidue(input: {
  readonly worktreesDir: string;
  readonly snapshotsDir: string;
  readonly worktreePath: string;
}): Effect.Effect<void, never> {
  const discardSnapshots = Effect.tryPromise({
    try: async () => {
      const canonicalPath = await canonicalizeRemovedPath(input.worktreePath);
      const pathForms = new Set([
        input.worktreePath,
        path.resolve(input.worktreePath),
        canonicalPath,
      ]);
      const digestSuffixes = [...pathForms].map(
        (candidate) => `-${snapshotDigestForWorktreePath(candidate)}`,
      );
      const removed: string[] = [];
      for (const snapshotPath of await listSnapshotDirectories(input.snapshotsDir)) {
        const name = path.basename(snapshotPath);
        let matches = digestSuffixes.some(
          (suffix) => name.endsWith(suffix) || name.includes(`${suffix}.tmp-`),
        );
        if (!matches) {
          const manifest = await readSnapshotManifest(snapshotPath);
          const sourceWorktree = manifest?.sourceWorktree;
          matches =
            typeof sourceWorktree === "string" &&
            (pathForms.has(sourceWorktree) ||
              pathForms.has(await canonicalizeRemovedPath(sourceWorktree)));
        }
        if (!matches) continue;
        await fs.rm(snapshotPath, { recursive: true, force: true });
        removed.push(snapshotPath);
      }
      return removed;
    },
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("managed worktree cleanup could not discard recovery snapshots", {
        worktreePath: input.worktreePath,
        error: errorMessage(cause),
      }),
    ),
  );

  return Effect.andThen(
    discardSnapshots,
    discardEmptyManagedWorktreeParent({
      worktreesDir: input.worktreesDir,
      worktreePath: input.worktreePath,
    }),
  );
}

// Never fails.
export function pruneExpiredManagedWorktreeSnapshots(input: {
  readonly snapshotsDir: string;
  readonly now?: number;
}): Effect.Effect<ReadonlyArray<string>, never> {
  return Effect.tryPromise({
    try: () => listSnapshotDirectories(input.snapshotsDir),
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.flatMap((snapshotPaths) => {
      const now = input.now ?? Date.now();
      return Effect.forEach(
        snapshotPaths,
        (snapshotPath) =>
          Effect.tryPromise({
            try: async () => {
              let createdAtMs: number;
              if (SNAPSHOT_STAGING_DIR_PATTERN.test(path.basename(snapshotPath))) {
                createdAtMs = (await fs.stat(snapshotPath)).mtimeMs;
              } else {
                const createdAt = (await readSnapshotManifest(snapshotPath))?.createdAt;
                if (typeof createdAt !== "string") return null;
                createdAtMs = Date.parse(createdAt);
              }
              if (
                !Number.isFinite(createdAtMs) ||
                now - createdAtMs <= MANAGED_WORKTREE_SNAPSHOT_RETENTION_MS
              ) {
                return null;
              }
              await fs.rm(snapshotPath, { recursive: true, force: true });
              return snapshotPath;
            },
            catch: (cause) => normalizeOperationError(cause),
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("managed worktree snapshot expiry skipped an entry", {
                snapshotPath,
                error: errorMessage(cause),
              }).pipe(Effect.as(null)),
            ),
          ),
        { concurrency: 1 },
      );
    }),
    Effect.map((removed) => removed.filter((entry): entry is string => entry !== null)),
    Effect.catch((cause) =>
      Effect.logWarning("managed worktree snapshot expiry could not scan snapshots", {
        snapshotsDir: input.snapshotsDir,
        error: errorMessage(cause),
      }).pipe(Effect.as([] as ReadonlyArray<string>)),
    ),
  );
}
