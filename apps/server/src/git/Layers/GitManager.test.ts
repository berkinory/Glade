import fs from "node:fs";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError, Scope } from "effect";
import { expect } from "vitest";
import type { GitActionProgressEvent } from "@glade/contracts/git/git";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";

import { GitCommandError, TextGenerationError } from "../Errors.ts";
import { type GitManagerShape } from "../Services/GitManager.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import {
  type AutomationIntentGenerationInput,
  type AutomationIntentGenerationResult,
  type AutomationCompletionEvaluationInput,
  type AutomationCompletionEvaluationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";
import { GitCoreLive } from "./GitCore.ts";
import { GitCore } from "../Services/GitCore.ts";
import { createGitHubCliWithFakeGh, type FakeGhScenario } from "../testing/fakeGitHubCli.ts";
import { makeGitManager } from "./GitManager.ts";
import { ServerConfig } from "../../server/config.ts";

interface FakeGitTextGeneration {
  generateCommitMessage: (input: {
    cwd: string;
    branch: string | null;
    stagedSummary: string;
    stagedPatch: string;
    codexHomePath?: string;
    providerOptions?: ProviderStartOptions;
    includeBranch?: boolean;
    model?: string;
    modelSelection?: ModelSelection;
  }) => Effect.Effect<
    { subject: string; body: string; branch?: string | undefined },
    TextGenerationError
  >;
  generatePrContent: (input: {
    cwd: string;
    baseBranch: string;
    headBranch: string;
    commitSummary: string;
    diffSummary: string;
    diffPatch: string;
    prTemplate?: string | undefined;
    codexHomePath?: string;
    providerOptions?: ProviderStartOptions;
    model?: string;
    modelSelection?: ModelSelection;
  }) => Effect.Effect<{ title: string; body: string }, TextGenerationError>;
  generateDiffSummary: (input: {
    cwd: string;
    patch: string;
    codexHomePath?: string;
    providerOptions?: ProviderStartOptions;
    model?: string;
    modelSelection?: ModelSelection;
  }) => Effect.Effect<{ summary: string }, TextGenerationError>;
  generateBranchName: (input: {
    cwd: string;
    message: string;
    providerOptions?: ProviderStartOptions;
    model?: string;
    modelSelection?: ModelSelection;
  }) => Effect.Effect<{ branch: string }, TextGenerationError>;
  generateThreadTitle: (input: {
    cwd: string;
    message: string;
    providerOptions?: ProviderStartOptions;
    model?: string;
    modelSelection?: ModelSelection;
  }) => Effect.Effect<{ title: string }, TextGenerationError>;
  generateAutomationIntent: (
    input: AutomationIntentGenerationInput,
  ) => Effect.Effect<AutomationIntentGenerationResult, TextGenerationError>;
  evaluateAutomationCompletion: (
    input: AutomationCompletionEvaluationInput,
  ) => Effect.Effect<AutomationCompletionEvaluationResult, TextGenerationError>;
}

function makeTempDir(
  prefix: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function runGit(
  cwd: string,
  args: readonly string[],
  allowNonZeroExit = false,
): Effect.Effect<
  { readonly code: number; readonly stdout: string; readonly stderr: string },
  GitCommandError,
  GitCore
> {
  return Effect.gen(function* () {
    const gitCore = yield* GitCore;
    return yield* gitCore.execute({
      operation: "GitManager.test.runGit",
      cwd,
      args,
      allowNonZeroExit,
    });
  });
}

function initRepo(
  cwd: string,
): Effect.Effect<
  void,
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Scope.Scope | GitCore
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* runGit(cwd, ["init", "--initial-branch=main"]);
    yield* runGit(cwd, ["config", "user.email", "test@example.com"]);
    yield* runGit(cwd, ["config", "user.name", "Test User"]);
    yield* fs.writeFileString(path.join(cwd, "README.md"), "hello\n");
    yield* runGit(cwd, ["add", "README.md"]);
    yield* runGit(cwd, ["commit", "-m", "Initial commit"]);
  });
}

function createBareRemote(): Effect.Effect<
  string,
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Scope.Scope | GitCore
> {
  return Effect.gen(function* () {
    const remoteDir = yield* makeTempDir("glade-git-remote-");
    yield* runGit(remoteDir, ["init", "--bare"]);
    return remoteDir;
  });
}

function createTextGeneration(overrides: Partial<FakeGitTextGeneration> = {}): TextGenerationShape {
  const implementation: FakeGitTextGeneration = {
    generateCommitMessage: (input) =>
      Effect.succeed({
        subject: "Implement stacked git actions",
        body: "",
        ...(input.includeBranch ? { branch: "feature/implement-stacked-git-actions" } : {}),
      }),
    generatePrContent: () =>
      Effect.succeed({
        title: "Add stacked git actions",
        body: "## Summary\n- Add stacked git workflow\n\n## Testing\n- Not run",
      }),
    generateDiffSummary: () =>
      Effect.succeed({
        summary: "## Summary\n- Explain the selected diff\n\n## Files Changed\n- Not run",
      }),
    generateBranchName: () =>
      Effect.succeed({
        branch: "update-workflow",
      }),
    generateThreadTitle: () =>
      Effect.succeed({
        title: "Update workflow",
      }),
    generateAutomationIntent: () =>
      Effect.succeed({
        isAutomation: true,
        confidence: 1,
        language: null,
        name: "Check site",
        taskPrompt: "Check the site",
        schedule: { type: "interval", everySeconds: 3600 },
        mode: "heartbeat",
        completionPolicy: { type: "none" },
        missingFields: [],
        needsConfirmation: false,
        reason: null,
      }),
    evaluateAutomationCompletion: () =>
      Effect.succeed({
        stopMatched: false,
        confidence: 0.2,
        reason: "Stop condition was not met.",
      }),
    ...overrides,
  };

  return {
    generateCommitMessage: (input) =>
      implementation.generateCommitMessage(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateCommitMessage",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    generatePrContent: (input) =>
      implementation.generatePrContent(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generatePrContent",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    generateDiffSummary: (input) =>
      implementation.generateDiffSummary(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateDiffSummary",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    generateBranchName: (input) =>
      implementation.generateBranchName(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateBranchName",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    generateThreadTitle: (input) =>
      implementation.generateThreadTitle(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    generateAutomationIntent: (input) =>
      implementation.generateAutomationIntent(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateAutomationIntent",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
    evaluateAutomationCompletion: (input) =>
      implementation.evaluateAutomationCompletion(input).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "evaluateAutomationCompletion",
              detail: "fake text generation failed",
              ...(cause !== undefined ? { cause } : {}),
            }),
        ),
      ),
  };
}

function runStackedAction(
  manager: GitManagerShape,
  input: {
    cwd: string;
    action: "commit" | "push" | "create_pr" | "commit_push" | "commit_push_pr";
    actionId?: string;
    commitMessage?: string;
    featureBranch?: boolean;
    filePaths?: readonly string[];
    prTitle?: string;
    prBody?: string;
    prDraft?: boolean;
    allowDirtyWorkingTree?: boolean;
  },
  options?: Parameters<GitManagerShape["runStackedAction"]>[1],
) {
  return manager.runStackedAction(
    {
      ...input,
      actionId: input.actionId ?? "test-action-id",
    },
    options,
  );
}

function preparePullRequestThread(
  manager: GitManagerShape,
  input: { cwd: string; reference: string; mode: "local" | "worktree" },
) {
  return manager.preparePullRequestThread(input);
}

function makeManager(input?: {
  ghScenario?: FakeGhScenario;
  textGeneration?: Partial<FakeGitTextGeneration>;
}) {
  const { service: gitHubCli, ghCalls } = createGitHubCliWithFakeGh(input?.ghScenario);
  const textGeneration = createTextGeneration(input?.textGeneration);
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "glade-git-manager-test-",
  });

  const gitCoreLayer = GitCoreLive.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerConfigLayer),
  );

  const managerLayer = Layer.mergeAll(
    Layer.succeed(GitHubCli, gitHubCli),
    Layer.succeed(TextGeneration, textGeneration),
    gitCoreLayer,
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return makeGitManager.pipe(
    Effect.provide(managerLayer),
    Effect.map((manager) => ({ manager, ghCalls })),
  );
}

const GitManagerTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-git-manager-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(GitManagerTestLayer)("GitManager", (it) => {
  it.effect("generates a message from the index without staging or committing anything", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir("glade-message-preview-");
      yield* initRepo(cwd);
      fs.writeFileSync(path.join(cwd, "README.md"), "staged content\n");
      yield* runGit(cwd, ["add", "README.md"]);
      fs.writeFileSync(path.join(cwd, "README.md"), "unstaged content\n");
      fs.writeFileSync(path.join(cwd, "new.txt"), "untracked content\n");
      const head = (yield* runGit(cwd, ["rev-parse", "HEAD"])).stdout;
      const index = (yield* runGit(cwd, ["write-tree"])).stdout;
      const status = (yield* runGit(cwd, ["status", "--porcelain"])).stdout;
      const { manager } = yield* makeManager({
        textGeneration: {
          generateCommitMessage: (input) => {
            expect(input.stagedPatch).toContain("+staged content");
            expect(input.stagedPatch).not.toContain("unstaged content");
            expect(input.stagedPatch).not.toContain("untracked content");
            return Effect.succeed({
              subject: "Update readme",
              body: "Describe the staged change.",
            });
          },
        },
      });
      expect(yield* manager.generateCommitMessage({ cwd })).toEqual({
        message: "Update readme\n\nDescribe the staged change.",
      });
      expect((yield* runGit(cwd, ["rev-parse", "HEAD"])).stdout).toBe(head);
      expect((yield* runGit(cwd, ["write-tree"])).stdout).toBe(index);
      expect((yield* runGit(cwd, ["status", "--porcelain"])).stdout).toBe(status);
      expect(fs.readFileSync(path.join(cwd, "README.md"), "utf8")).toBe("unstaged content\n");
    }),
  );
  it.effect("refuses to summarize a working-tree patch whose capture was truncated", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("glade-truncated-summary-");
      yield* initRepo(repoDir);
      yield* Effect.sync(() => {
        fs.writeFileSync(path.join(repoDir, "oversized.txt"), "generated line\n".repeat(100_000));
      });
      let generationCalls = 0;
      const { manager } = yield* makeManager({
        textGeneration: {
          generateDiffSummary: () => {
            generationCalls += 1;
            return Effect.succeed({ summary: "## Summary\n- Partial input" });
          },
        },
      });

      const captured = yield* manager.readWorkingTreeDiff({
        cwd: repoDir,
        scope: "workingTree",
      });
      expect(captured.truncated).toBe(true);

      const result = yield* Effect.result(
        manager.summarizeDiff({ cwd: repoDir, scope: "workingTree" }),
      );

      expect(result._tag).toBe("Failure");
      expect(generationCalls).toBe(0);
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          _tag: "GitManagerError",
          operation: "summarizeDiff",
        });
        expect(result.failure.message).toContain("truncated diff");
      }
    }),
  );

  it.effect(
    "creates feature branch, pushes, and opens PR for already-committed work",
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir("glade-git-manager-");
        yield* initRepo(repoDir);
        const remoteDir = yield* createBareRemote();
        yield* runGit(repoDir, ["remote", "add", "origin", remoteDir]);
        yield* runGit(repoDir, ["push", "-u", "origin", "main"]);
        const originalMainSha = yield* runGit(repoDir, ["rev-parse", "main"]).pipe(
          Effect.map((gitResult) => gitResult.stdout.trim()),
        );
        fs.writeFileSync(path.join(repoDir, "README.md"), "hello\ncreate-pr-from-default\n");
        yield* runGit(repoDir, ["add", "README.md"]);
        yield* runGit(repoDir, ["commit", "-m", "Create PR from default branch"]);

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListSequence: [
              "[]",
              "[]",
              "[]",
              JSON.stringify([
                {
                  number: 90,
                  title: "Create PR from default branch",
                  url: "https://github.com/example-org/sample-repo/pull/90",
                  baseRefName: "main",
                  headRefName: "feature/create-pr-from-default-branch",
                },
              ]),
            ],
          },
        });
        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "create_pr",
          featureBranch: true,
        });

        expect(result.branch.status).toBe("created");
        expect(result.branch.name).toBe("feature/create-pr-from-default-branch");
        expect(result.commit.status).toBe("skipped_not_requested");
        expect(result.push.status).toBe("pushed");
        expect(result.pr.status).toBe("created");
        expect(
          yield* runGit(repoDir, ["rev-parse", "--abbrev-ref", "@{upstream}"]).pipe(
            Effect.map((gitResult) => gitResult.stdout.trim()),
          ),
        ).toBe("origin/feature/create-pr-from-default-branch");
        expect(
          ghCalls.some((call) =>
            call.includes("pr create --base main --head feature/create-pr-from-default-branch"),
          ),
        ).toBe(true);
        expect(
          yield* runGit(repoDir, ["rev-parse", "main"]).pipe(
            Effect.map((gitResult) => gitResult.stdout.trim()),
          ),
        ).toBe(originalMainSha);
      }),
    30_000,
  );

  it.effect(
    "blocks feature-branch push when the source branch has no upstream and multiple remotes",
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir("glade-git-manager-");
        yield* initRepo(repoDir);
        const originDir = yield* createBareRemote();
        const forkDir = yield* createBareRemote();
        yield* runGit(repoDir, ["remote", "add", "origin", originDir]);
        yield* runGit(repoDir, ["remote", "add", "fork", forkDir]);
        yield* runGit(repoDir, ["push", "-u", "origin", "main"]);
        yield* runGit(repoDir, ["push", "fork", "main"]);
        yield* runGit(repoDir, ["branch", "--unset-upstream", "main"]);
        fs.writeFileSync(path.join(repoDir, "README.md"), "hello\nmulti-remote-block\n");
        yield* runGit(repoDir, ["add", "README.md"]);
        yield* runGit(repoDir, ["commit", "-m", "Push from default branch with multiple remotes"]);

        const { manager } = yield* makeManager();
        const errorMessage = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "push",
          featureBranch: true,
        }).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
        );

        expect(errorMessage).toContain("has no upstream and this repository has multiple remotes");
      }),
    30_000,
  );

  it.effect(
    "rejects create_pr with uncommitted changes unless the caller opts out of the guard",
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir("glade-git-manager-");
        yield* initRepo(repoDir);
        yield* runGit(repoDir, ["checkout", "-b", "feature/dirty-create-pr"]);
        const remoteDir = yield* createBareRemote();
        yield* runGit(repoDir, ["remote", "add", "origin", remoteDir]);
        fs.writeFileSync(path.join(repoDir, "committed.txt"), "committed\n");
        yield* runGit(repoDir, ["add", "committed.txt"]);
        yield* runGit(repoDir, ["commit", "-m", "Committed work"]);
        fs.writeFileSync(path.join(repoDir, "uncommitted.txt"), "left out\n");

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListSequence: [
              "[]",
              "[]",
              "[]",
              JSON.stringify([
                {
                  number: 92,
                  title: "Committed work",
                  url: "https://github.com/example-org/sample-repo/pull/92",
                  baseRefName: "main",
                  headRefName: "feature/dirty-create-pr",
                },
              ]),
            ],
          },
        });
        const guardedError = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "create_pr",
        }).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
        );
        expect(guardedError).toContain("Commit local changes before creating a PR.");
        expect(ghCalls.some((call) => call.startsWith("pr create "))).toBe(false);

        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "create_pr",
          allowDirtyWorkingTree: true,
        });

        expect(result.commit.status).toBe("skipped_not_requested");
        expect(result.push.status).toBe("pushed");
        expect(result.pr.status).toBe("created");
        const status = yield* runGit(repoDir, ["status", "--porcelain"]).pipe(
          Effect.map((gitResult) => gitResult.stdout),
        );
        expect(status).toContain("uncommitted.txt");
      }),
    30_000,
  );

  it.effect(
    "rejects push with uncommitted changes unless the caller opts out of the guard",
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir("glade-git-manager-");
        yield* initRepo(repoDir);
        yield* runGit(repoDir, ["checkout", "-b", "feature/dirty-push"]);
        const remoteDir = yield* createBareRemote();
        yield* runGit(repoDir, ["remote", "add", "origin", remoteDir]);
        fs.writeFileSync(path.join(repoDir, "committed.txt"), "committed\n");
        yield* runGit(repoDir, ["add", "committed.txt"]);
        yield* runGit(repoDir, ["commit", "-m", "Committed work"]);
        fs.writeFileSync(path.join(repoDir, "uncommitted.txt"), "left out\n");

        const { manager } = yield* makeManager();
        const guardedError = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "push",
        }).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
        );
        expect(guardedError).toContain("Commit or stash local changes before pushing.");

        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: "push",
          allowDirtyWorkingTree: true,
        });

        expect(result.commit.status).toBe("skipped_not_requested");
        expect(result.push.status).toBe("pushed");
        const status = yield* runGit(repoDir, ["status", "--porcelain"]).pipe(
          Effect.map((gitResult) => gitResult.stdout),
        );
        expect(status).toContain("uncommitted.txt");
      }),
    30_000,
  );

  it.effect("rejects push/pr actions from detached HEAD", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("glade-git-manager-");
      yield* initRepo(repoDir);
      yield* runGit(repoDir, ["checkout", "--detach", "HEAD"]);

      const { manager } = yield* makeManager();
      const errorMessage = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: "commit_push",
      }).pipe(
        Effect.flip,
        Effect.map((error) => error.message),
      );
      expect(errorMessage).toContain("detached HEAD");
    }),
  );

  it.effect("preserves fork upstream tracking when preparing a worktree PR thread", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("glade-git-manager-");
      yield* initRepo(repoDir);
      const originDir = yield* createBareRemote();
      const forkDir = yield* createBareRemote();
      yield* runGit(repoDir, ["remote", "add", "origin", originDir]);
      yield* runGit(repoDir, ["push", "-u", "origin", "main"]);
      yield* runGit(repoDir, ["remote", "add", "fork-seed", forkDir]);
      yield* runGit(repoDir, ["checkout", "-b", "feature/pr-fork"]);
      fs.writeFileSync(path.join(repoDir, "fork.txt"), "fork\n");
      yield* runGit(repoDir, ["add", "fork.txt"]);
      yield* runGit(repoDir, ["commit", "-m", "Fork PR branch"]);
      yield* runGit(repoDir, ["push", "-u", "fork-seed", "feature/pr-fork"]);
      yield* runGit(repoDir, ["checkout", "main"]);

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 81,
            title: "Fork PR",
            url: "https://github.com/example-org/sample-repo/pull/81",
            baseRefName: "main",
            headRefName: "feature/pr-fork",
            state: "open",
            isCrossRepository: true,
            headRepositoryNameWithOwner: "octocat/sample-repo",
            headRepositoryOwnerLogin: "octocat",
          },
          repositoryCloneUrls: {
            "octocat/sample-repo": {
              url: forkDir,
              sshUrl: forkDir,
            },
          },
        },
      });

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: "81",
        mode: "worktree",
      });

      expect(result.worktreePath).not.toBeNull();
      const upstreamRef = (yield* runGit(result.worktreePath as string, [
        "rev-parse",
        "--abbrev-ref",
        "@{upstream}",
      ])).stdout.trim();
      expect(upstreamRef).toBe("fork-seed/feature/pr-fork");
      expect(upstreamRef.startsWith("origin/")).toBe(false);
      expect(
        (yield* runGit(result.worktreePath as string, [
          "config",
          "--get",
          "remote.fork-seed.url",
        ])).stdout.trim(),
      ).toBe(forkDir);
    }),
  );

  it.effect(
    "does not overwrite an existing local main branch when preparing a fork PR worktree",
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir("glade-git-manager-");
        yield* initRepo(repoDir);
        const originDir = yield* createBareRemote();
        const forkDir = yield* createBareRemote();
        yield* runGit(repoDir, ["remote", "add", "origin", originDir]);
        yield* runGit(repoDir, ["push", "-u", "origin", "main"]);
        yield* runGit(repoDir, ["remote", "add", "fork-seed", forkDir]);
        yield* runGit(repoDir, ["checkout", "-b", "fork-main-source"]);
        fs.writeFileSync(path.join(repoDir, "fork-main-second.txt"), "fork main second\n");
        yield* runGit(repoDir, ["add", "fork-main-second.txt"]);
        yield* runGit(repoDir, ["commit", "-m", "Fork main second branch"]);
        yield* runGit(repoDir, ["push", "-u", "fork-seed", "fork-main-source:main"]);
        yield* runGit(repoDir, ["checkout", "main"]);
        const localMainBefore = (yield* runGit(repoDir, ["rev-parse", "main"])).stdout.trim();
        yield* runGit(repoDir, ["checkout", "-b", "feature/root-branch"]);

        const { manager } = yield* makeManager({
          ghScenario: {
            pullRequest: {
              number: 92,
              title: "Fork main overwrite PR",
              url: "https://github.com/example-org/sample-repo/pull/92",
              baseRefName: "main",
              headRefName: "main",
              state: "open",
              isCrossRepository: true,
              headRepositoryNameWithOwner: "octocat/sample-repo",
              headRepositoryOwnerLogin: "octocat",
            },
            repositoryCloneUrls: {
              "octocat/sample-repo": {
                url: forkDir,
                sshUrl: forkDir,
              },
            },
          },
        });

        const result = yield* preparePullRequestThread(manager, {
          cwd: repoDir,
          reference: "92",
          mode: "worktree",
        });

        expect(result.branch).toBe("glade/pr-92/main");
        expect((yield* runGit(repoDir, ["rev-parse", "main"])).stdout.trim()).toBe(localMainBefore);
        expect(
          (yield* runGit(result.worktreePath as string, [
            "rev-parse",
            "--abbrev-ref",
            "@{upstream}",
          ])).stdout.trim(),
        ).toBe("fork-seed/main");
      }),
  );

  it.effect("emits action_failed when a commit hook rejects", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("glade-git-manager-");
      yield* initRepo(repoDir);
      fs.writeFileSync(path.join(repoDir, "hook-failure.txt"), "broken\n");
      fs.writeFileSync(
        path.join(repoDir, ".git", "hooks", "pre-commit"),
        '#!/bin/sh\necho "hook: fail" >&2\nexit 1\n',
        { mode: 0o755 },
      );

      const { manager } = yield* makeManager();
      const events: GitActionProgressEvent[] = [];

      const errorMessage = yield* runStackedAction(
        manager,
        {
          cwd: repoDir,
          action: "commit",
        },
        {
          actionId: "action-2",
          progressReporter: {
            publish: (event) =>
              Effect.sync(() => {
                events.push(event);
              }),
          },
        },
      ).pipe(
        Effect.flip,
        Effect.map((error) => error.message),
      );

      expect(errorMessage).toContain("hook: fail");
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "hook_started",
            hookName: "pre-commit",
          }),
          expect.objectContaining({
            kind: "action_failed",
            phase: "commit",
          }),
        ]),
      );
    }),
  );
});
