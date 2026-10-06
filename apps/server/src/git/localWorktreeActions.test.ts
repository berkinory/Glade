import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Schema } from "effect";
import { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { expect } from "vitest";
import path from "node:path";
import { ServerConfig } from "../server/config";
import { GitCoreLive } from "./Layers/GitCore";
import { GitCore } from "./Services/GitCore";
import { localWorktreeActions } from "./localWorktreeActions";
import { sourceControlActions } from "./sourceControlActions";
import { localWorktreeRoutes } from "./localWorktreeRoutes";

function modelFor(main: string, worktree: string) {
  const date = "2026-10-04T00:00:00.000Z";
  return Schema.decodeUnknownSync(OrchestrationReadModel)({
    snapshotSequence: 0,
    updatedAt: date,
    spaces: [],
    projects: [
      {
        id: "project",
        title: "Project",
        workspaceRoot: main,
        defaultModelSelection: null,
        createdAt: date,
        updatedAt: date,
        deletedAt: null,
      },
    ],
    threads: [
      { id: "worktree", worktreePath: worktree, branch: "task-a" },
      { id: "local", worktreePath: null, branch: "main" },
    ].map((thread) => ({
      ...thread,
      projectId: "project",
      title: thread.id,
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      latestTurn: null,
      session: null,
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
    })),
  });
}

const layer = GitCoreLive.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-local-merge-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const setup = Effect.gen(function* () {
  const git = yield* GitCore;
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: "glade-local-merge-" });
  const main = path.join(directory, "main checkout");
  yield* files.makeDirectory(main);
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ cwd, args, operation: "test" });
  const write = (cwd: string, name: string, content: string) =>
    files.writeFileString(path.join(cwd, name), content);
  yield* run(main, ["init", "-b", "main"]);
  yield* run(main, ["config", "user.name", "Test"]);
  yield* run(main, ["config", "user.email", "test@example.com"]);
  yield* run(main, ["config", "commit.gpgsign", "false"]);
  yield* write(main, "greeting.txt", "hello\n");
  yield* write(main, "theme.txt", "light\n");
  yield* run(main, ["add", "."]);
  yield* run(main, ["commit", "-m", "Initial"]);
  const a = path.join(directory, "worktree a");
  const b = path.join(directory, "worktree b");
  yield* run(main, ["worktree", "add", "-b", "task-a", a]);
  yield* run(main, ["worktree", "add", "-b", "task-b", b]);
  const commit = (cwd: string, name: string, content: string) =>
    Effect.gen(function* () {
      yield* write(cwd, name, content);
      yield* run(cwd, ["add", name]);
      yield* run(cwd, ["commit", "-m", `Change ${name}`]);
    });
  const actions = localWorktreeActions(git);
  const apply = (cwd: string, action: "merge" | "update") =>
    git.withMutation(
      cwd,
      Effect.gen(function* () {
        return yield* actions.apply(yield* actions.read(cwd), action);
      }),
    );
  return { git, files, main, a, b, run, write, commit, actions, apply };
});

it.layer(layer)("local worktree integration", (it) => {
  it.effect("automatic sync skips pending commits and updates a fully integrated worktree", () =>
    Effect.gen(function* () {
      const { git, main, a, b, run, commit, apply } = yield* setup;
      const model = modelFor(main, a);
      const threadId = model.threads[0]!.id;
      const routes = localWorktreeRoutes(git, { getReadModel: () => Effect.succeed(model) });
      yield* commit(a, "greeting.txt", "pending\n");
      yield* commit(b, "theme.txt", "dark\n");
      yield* apply(b, "merge");
      const pending = (yield* run(a, ["rev-parse", "HEAD"])).stdout;
      yield* routes.run({ threadId, action: "sync" });
      expect((yield* run(a, ["rev-parse", "HEAD"])).stdout).toBe(pending);
      const targetHead = (yield* run(main, ["rev-parse", "HEAD"])).stdout;
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            routes.run({ threadId, action: "merge", targetBranch: "other-branch" }),
          ),
        ),
      ).toBe(true);
      expect((yield* run(main, ["rev-parse", "HEAD"])).stdout).toBe(targetHead);
      expect((yield* run(a, ["rev-parse", "HEAD"])).stdout).toBe(pending);
      yield* routes.run({ threadId, action: "merge" });
      yield* commit(main, "theme.txt", "new theme\n");
      yield* routes.run({ threadId, action: "sync" });
      expect((yield* run(a, ["rev-parse", "HEAD"])).stdout).toBe(
        (yield* run(main, ["rev-parse", "HEAD"])).stdout,
      );
    }),
  );

  for (const activeId of ["worktree", "local"]) {
    it.effect(`refuses integration and auto sync while an agent runs in ${activeId}`, () =>
      Effect.gen(function* () {
        const { git, main, a, run, commit } = yield* setup;
        yield* commit(main, "theme.txt", "new theme\n");
        const model = modelFor(main, a);
        const active = model.threads.find((thread) => thread.id === activeId)!;
        const snapshot = {
          ...model,
          threads: model.threads.map((thread) =>
            thread.id === active.id
              ? {
                  ...thread,
                  session: {
                    threadId: thread.id,
                    status: "running" as const,
                    providerName: "codex",
                    runtimeMode: thread.runtimeMode,
                    activeTurnId: null,
                    lastError: null,
                    updatedAt: model.updatedAt,
                  },
                }
              : thread,
          ),
        };
        const routes = localWorktreeRoutes(git, { getReadModel: () => Effect.succeed(snapshot) });
        const threadId = model.threads[0]!.id;
        const head = (yield* run(a, ["rev-parse", "HEAD"])).stdout;
        expect(Exit.isFailure(yield* Effect.exit(routes.run({ threadId, action: "update" })))).toBe(
          true,
        );
        yield* routes.run({ threadId, action: "sync" });
        expect((yield* run(a, ["rev-parse", "HEAD"])).stdout).toBe(head);
      }),
    );
  }

  it.effect(
    "integrates two independent worktrees and keeps both branches available for follow-ups",
    () =>
      Effect.gen(function* () {
        const { main, a, b, run, commit, apply, actions } = yield* setup;
        yield* commit(a, "greeting.txt", "welcome\n");
        yield* commit(b, "theme.txt", "dark\n");
        yield* apply(a, "merge");
        expect((yield* actions.read(b)).behind).toBe(1);
        yield* apply(b, "merge");
        expect((yield* run(main, ["show", "HEAD:greeting.txt"])).stdout).toBe("welcome\n");
        expect((yield* run(main, ["show", "HEAD:theme.txt"])).stdout).toBe("dark\n");
        yield* apply(a, "update");
        yield* commit(a, "greeting.txt", "welcome again\n");
        yield* apply(a, "merge");
        expect((yield* run(main, ["show", "HEAD:greeting.txt"])).stdout).toBe("welcome again\n");
        expect((yield* run(a, ["branch", "--show-current"])).stdout.trim()).toBe("task-a");
        expect((yield* run(b, ["branch", "--show-current"])).stdout.trim()).toBe("task-b");
      }),
  );

  it.effect("leaves the primary checkout unchanged on a rebase conflict and supports abort", () =>
    Effect.gen(function* () {
      const { main, a, b, run, commit, apply } = yield* setup;
      yield* commit(a, "greeting.txt", "first\n");
      yield* commit(b, "greeting.txt", "second\n");
      yield* apply(a, "merge");
      const mainHead = (yield* run(main, ["rev-parse", "HEAD"])).stdout;
      const sourceHead = (yield* run(b, ["rev-parse", "HEAD"])).stdout;
      expect(Exit.isFailure(yield* Effect.exit(apply(b, "merge")))).toBe(true);
      const controls = sourceControlActions(yield* GitCore);
      expect((yield* controls.rebaseState(b)).conflicts).toEqual(["greeting.txt"]);
      expect((yield* run(main, ["rev-parse", "HEAD"])).stdout).toBe(mainHead);
      yield* controls.rebase({ cwd: b, action: "abort", operation: "rebase" });
      expect((yield* run(b, ["rev-parse", "HEAD"])).stdout).toBe(sourceHead);
    }),
  );

  it.effect("refuses dirty primary and source checkouts without clearing user changes", () =>
    Effect.gen(function* () {
      const { main, a, run, write, commit, apply } = yield* setup;
      yield* commit(a, "greeting.txt", "welcome\n");
      const head = (yield* run(main, ["rev-parse", "HEAD"])).stdout;
      yield* write(main, "theme.txt", "unsaved primary\n");
      expect(Exit.isFailure(yield* Effect.exit(apply(a, "merge")))).toBe(true);
      expect((yield* run(main, ["rev-parse", "HEAD"])).stdout).toBe(head);
      expect((yield* run(main, ["diff", "--", "theme.txt"])).stdout).toContain("unsaved primary");
      yield* run(main, ["restore", "theme.txt"]);
      yield* write(a, "theme.txt", "unsaved worktree\n");
      expect(Exit.isFailure(yield* Effect.exit(apply(a, "merge")))).toBe(true);
      expect((yield* run(main, ["rev-parse", "HEAD"])).stdout).toBe(head);
      expect((yield* run(a, ["diff", "--", "theme.txt"])).stdout).toContain("unsaved worktree");
    }),
  );

  it.effect(
    "preserves a published commit even when the worktree HEAD has newer unpublished commits",
    () =>
      Effect.gen(function* () {
        const { main, a, b, run, commit, apply } = yield* setup;
        yield* commit(a, "greeting.txt", "published\n");
        const published = (yield* run(a, ["rev-parse", "HEAD"])).stdout.trim();
        yield* run(main, ["update-ref", "refs/remotes/origin/task-a", published]);
        yield* commit(a, "greeting.txt", "unpublished\n");
        yield* commit(b, "theme.txt", "dark\n");
        yield* apply(b, "merge");
        yield* apply(a, "merge");
        expect((yield* run(main, ["merge-base", "--is-ancestor", published, "HEAD"])).code).toBe(0);
        expect((yield* run(main, ["show", "HEAD:greeting.txt"])).stdout).toBe("unpublished\n");
      }),
  );
});
