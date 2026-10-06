import { Effect, Layer, Semaphore } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GitCommandError } from "../Errors";
import { GitCommands } from "../Services/GitCommands";
import { GitRepositoryMetadata, type RepositoryMetadata } from "../Services/GitRepositoryMetadata";

interface CachedMetadata {
  readonly value: RepositoryMetadata;
  readonly paths: readonly string[];
  readonly refsDirectory: string;
  readonly fingerprint: string;
}

async function fingerprint(paths: readonly string[], refsDirectory: string): Promise<string> {
  return (
    await Promise.all(
      paths.map(async (file) => {
        const stat = await fs.stat(file, { bigint: true }).catch((cause: unknown) => {
          if (
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            cause.code === "ENOENT"
          )
            return null;
          throw cause;
        });
        if (!stat) return `${file}:missing`;
        // Index locks change the gitdir's timestamps without changing repository identity.
        return stat.isDirectory() &&
          file !== refsDirectory &&
          !file.startsWith(`${refsDirectory}${path.sep}`)
          ? `${file}:${stat.dev}:${stat.ino}`
          : `${file}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      }),
    )
  ).join("\0");
}

const makeMetadata = Effect.gen(function* () {
  const commands = yield* GitCommands;
  const readStdout = (operation: string, cwd: string, args: readonly string[]) =>
    commands
      .executeGit(operation, cwd, args, { priority: "background" })
      .pipe(Effect.map((result) => result.stdout));
  const cache = new Map<string, CachedMetadata>();
  const lock = yield* Semaphore.make(1);
  const stamp = (cwd: string, paths: readonly string[], refsDirectory: string) =>
    Effect.tryPromise({
      try: () => fingerprint(paths, refsDirectory),
      catch: (cause) =>
        new GitCommandError({
          operation: "GitRepositoryMetadata.fingerprint",
          cwd,
          command: "git config",
          detail: "Could not inspect repository metadata files.",
          cause,
        }),
    });
  const read = (cwd: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const cached = cache.get(cwd);
        if (
          cached &&
          cached.fingerprint === (yield* stamp(cwd, cached.paths, cached.refsDirectory))
        ) {
          cache.delete(cwd);
          cache.set(cwd, cached);
          return cached.value;
        }
        const directories = (yield* readStdout("GitRepositoryMetadata.paths", cwd, [
          "rev-parse",
          "--path-format=absolute",
          "--git-dir",
          "--git-common-dir",
        ]))
          .trim()
          .split("\n");
        const gitDir = directories[0]!;
        const commonDir = directories[1]!;
        const config = new Map<string, string>();
        const paths = new Set([
          path.join(cwd, ".git"),
          path.join(gitDir, "HEAD"),
          path.join(commonDir, "config"),
          path.join(gitDir, "config.worktree"),
          process.env.GIT_CONFIG_GLOBAL ?? path.join(os.homedir(), ".gitconfig"),
          path.join(
            process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
            "git",
            "config",
          ),
          process.env.GIT_CONFIG_SYSTEM ?? "/etc/gitconfig",
        ]);
        for (let directory = path.resolve(cwd); ; ) {
          paths.add(path.join(directory, ".git"));
          const parent = path.dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
        const output = yield* readStdout("GitRepositoryMetadata.config", cwd, [
          "config",
          "--null",
          "--show-origin",
          "--list",
        ]);
        const records = output.split("\0");
        for (let index = 0; index + 1 < records.length; index += 2) {
          const origin = records[index]!;
          const entry = records[index + 1]!;
          const separator = entry.indexOf("\n");
          if (separator >= 0) config.set(entry.slice(0, separator), entry.slice(separator + 1));
          if (origin.startsWith("file:")) {
            const originPath = path.resolve(cwd, origin.slice(5));
            paths.add(originPath);
            if (
              separator >= 0 &&
              /^(include|includeif\..+)\.path$/.test(entry.slice(0, separator))
            ) {
              const include = entry.slice(separator + 1).replace(/^~\//, `${os.homedir()}/`);
              paths.add(path.resolve(path.dirname(originPath), include));
            }
          }
        }
        const remotes = [...config.keys()]
          .flatMap((key) => {
            const match = /^remote\.(.+)\.url$/.exec(key);
            return match ? [match[1]!] : [];
          })
          .toSorted();
        const primaryRemote = remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
        const refsDirectory = path.join(commonDir, "refs");
        paths.add(refsDirectory);
        paths.add(path.join(commonDir, "packed-refs"));
        const refEntries = yield* Effect.tryPromise({
          try: () =>
            fs
              .readdir(refsDirectory, { recursive: true, withFileTypes: true })
              .catch((cause: unknown) => {
                if (
                  typeof cause === "object" &&
                  cause !== null &&
                  "code" in cause &&
                  cause.code === "ENOENT"
                )
                  return [];
                throw cause;
              }),
          catch: (cause) =>
            new GitCommandError({
              operation: "GitRepositoryMetadata.refs",
              cwd,
              command: "git for-each-ref",
              detail: "Could not inspect reference directories.",
              cause,
            }),
        });
        for (const entry of refEntries) {
          if (entry.isDirectory()) paths.add(path.join(entry.parentPath, entry.name));
        }
        const refOutput = yield* readStdout("GitRepositoryMetadata.refs", cwd, [
          "for-each-ref",
          "--format=%(refname)%00%(symref)",
        ]);
        const refs = new Map(
          refOutput
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf("\0");
              return [line.slice(0, separator), line.slice(separator + 1)] as const;
            }),
        );
        const headRef = primaryRemote ? `refs/remotes/${primaryRemote}/HEAD` : null;
        if (headRef) paths.add(path.join(commonDir, headRef));
        const head = headRef ? refs.get(headRef) : undefined;
        const prefix = `refs/remotes/${primaryRemote}/`;
        const defaultBranch = head?.startsWith(prefix) ? head.slice(prefix.length) || null : null;
        const value: RepositoryMetadata = {
          commonDir,
          configValue: (key) => config.get(key),
          hasRef: (ref) => refs.has(ref),
          primaryRemote,
          defaultBranch,
        };
        const watchedPaths = [...paths];
        cache.delete(cwd);
        if (cache.size >= 512) cache.delete(cache.keys().next().value!);
        cache.set(cwd, {
          value,
          paths: watchedPaths,
          refsDirectory,
          fingerprint: yield* stamp(cwd, watchedPaths, refsDirectory),
        });
        return value;
      }),
    );
  return { read };
});

export const GitRepositoryMetadataLive = Layer.effect(GitRepositoryMetadata, makeMetadata);
