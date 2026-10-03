import { refreshPublicationRefs } from "./gitPublication";
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";
import { readGitOperation } from "./gitOperationState";

export function pushIntent(cwd: string, execute: GitCoreShape["execute"]) {
  const io = <T>(action: () => Promise<T>) =>
    Effect.tryPromise({
      try: action,
      catch: (cause) =>
        new GitCommandError({
          cwd,
          operation: "push intent",
          command: "fs",
          detail: "Could not persist push recovery state.",
          cause,
        }),
    });
  const location = execute({
    cwd,
    operation: "push intent",
    args: ["rev-parse", "--path-format=absolute", "--git-path", "glade-push.json"],
  }).pipe(Effect.map((result) => result.stdout.trim()));
  return {
    save: (branch: string, head: string) =>
      Effect.gen(function* () {
        const file = yield* location;
        yield* io(() => fs.writeFile(file, JSON.stringify({ branch, head }), { flag: "wx" }));
      }),
    clear: () =>
      Effect.gen(function* () {
        const file = yield* location;
        yield* io(() => fs.rm(file, { force: true }));
      }),
    read: () =>
      Effect.gen(function* () {
        const file = yield* location;
        const raw = yield* io(() =>
          fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          }),
        );
        if (raw === null) return null;
        const value: unknown = yield* Effect.try({
          try: () => JSON.parse(raw),
          catch: (cause) =>
            new GitCommandError({
              cwd,
              operation: "push intent",
              command: "read",
              detail: "Invalid push recovery state.",
              cause,
            }),
        });
        if (
          !value ||
          typeof value !== "object" ||
          !("branch" in value) ||
          !("head" in value) ||
          typeof value.branch !== "string" ||
          typeof value.head !== "string"
        )
          return yield* new GitCommandError({
            cwd,
            operation: "push intent",
            command: "read",
            detail: "Invalid push recovery state. Inspect glade-push.json before continuing.",
          });
        return { branch: value.branch, head: value.head };
      }),
  };
}

export function synchronizePush(
  input: {
    cwd: string;
    branch: string;
    remote: string;
    target: string;
    hasUpstream: boolean;
    allowIntegration: boolean;
  },
  execute: GitCoreShape["execute"],
) {
  const { cwd, branch, remote, target } = input;
  const run = (args: readonly string[]) =>
    execute({ cwd, args, operation: "synchronize push", timeoutMs: 120_000 });
  const fail = (detail: string) =>
    new GitCommandError({ cwd, operation: "synchronize push", command: "git", detail });
  return Effect.gen(function* () {
    const operation = yield* readGitOperation(cwd, execute);
    if (operation.kind || operation.conflicts.length)
      return yield* fail("Resolve the current Git operation or conflicts before pushing.");
    const intent = pushIntent(cwd, execute);
    if (yield* intent.read())
      return yield* fail(
        "A previous synchronized push needs recovery. Continue or cancel it in Source Control.",
      );
    const head = (yield* run(["rev-parse", "--verify", "HEAD"])).stdout.trim();
    const fetchUrl = (yield* run(["remote", "get-url", remote])).stdout.trim();
    const pushUrls = (yield* run(["remote", "get-url", "--push", "--all", remote])).stdout
      .trim()
      .split("\n");
    if (pushUrls.length !== 1 || pushUrls[0] !== fetchUrl)
      return yield* fail("Automatic synchronization requires the same fetch and push destination.");
    const advertised = yield* run(["ls-remote", "--heads", remote, `refs/heads/${target}`]);
    if (advertised.stdout.trim()) {
      yield* run(["fetch", "--no-tags", remote, `refs/heads/${target}`]);
      const upstream = (yield* run(["rev-parse", "FETCH_HEAD"])).stdout.trim();
      const counts = (yield* run([
        "rev-list",
        "--left-right",
        "--count",
        `${head}...${upstream}`,
      ])).stdout
        .trim()
        .split(/\s+/)
        .map(Number);
      if ((counts[1] ?? 0) > 0) {
        if (!input.allowIntegration)
          return yield* fail("Save your open editors before Push integrates incoming commits.");
        if ((yield* run(["status", "--porcelain", "--untracked-files=all"])).stdout.trim())
          return yield* fail(
            "Commit or stash local changes before Push integrates incoming commits.",
          );
        if (
          (yield* run(["rev-parse", "HEAD"])).stdout.trim() !== head ||
          (yield* run(["symbolic-ref", "--short", "HEAD"])).stdout.trim() !== branch
        )
          return yield* fail("The branch changed during synchronization. Try Push again.");
        yield* run(["merge-base", head, upstream]);
        if ((counts[0] ?? 0) === 0) yield* run(["merge", "--ff-only", upstream]);
        else {
          if ((yield* run(["rev-list", "--merges", `${upstream}..${head}`])).stdout.trim())
            return yield* fail("Outgoing merge commits require manual integration before pushing.");
          yield* refreshPublicationRefs(cwd, execute);
          const outgoing = (yield* run(["rev-list", `${upstream}..${head}`])).stdout
            .trim()
            .split("\n");
          for (const sha of outgoing) {
            if (
              (yield* run([
                "for-each-ref",
                `--contains=${sha}`,
                "--format=%(refname)",
                "refs/remotes",
                "refs/tags",
                "refs/glade/publication",
              ])).stdout.trim()
            )
              return yield* fail(
                "Outgoing commits are already published. Integrate them manually before pushing.",
              );
          }
          yield* intent.save(branch, head);
          yield* run(["-c", "core.editor=true", "rebase", "--no-autostash", upstream]).pipe(
            Effect.onExit(() =>
              Effect.gen(function* () {
                if ((yield* readGitOperation(cwd, execute)).kind !== "rebase")
                  yield* intent.clear();
              }),
            ),
          );
          yield* intent.clear();
        }
      }
    } else if (input.hasUpstream)
      return yield* fail(
        "The upstream branch is missing. Choose a publication destination explicitly.",
      );
    yield* run(["push", ...(input.hasUpstream ? [] : ["-u"]), remote, `HEAD:refs/heads/${target}`]);
    return {
      status: "pushed" as const,
      branch,
      upstreamBranch: `${remote}/${target}`,
      setUpstream: !input.hasUpstream,
    };
  });
}
