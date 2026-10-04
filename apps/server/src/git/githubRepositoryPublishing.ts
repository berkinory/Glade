import path from "node:path";
import { Effect, Schema } from "effect";
import {
  GitPublishContextInput,
  GitPublishContextResult,
  GitPublishRepositoryInput,
  GitPublishRepositoryResult,
} from "@glade/contracts/git/githubRepositoryPublishing";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/git/githubRepository";
import { TrimmedNonEmptyString } from "@glade/contracts/core/baseSchemas";
import { GitCommandError, GitHubCliError } from "./Errors";
import { GitCore } from "./Services/GitCore";
import { GitHubCli } from "./Services/GitHubCli";
import { readGitOperation } from "./gitOperationState";

export function readGitPublishContext(input: GitPublishContextInput) {
  return Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHubCli;
    const root = yield* git.execute({
      cwd: input.cwd,
      operation: "publish context",
      args: ["rev-parse", "--show-toplevel"],
    });
    const remotes = yield* git.execute({
      cwd: input.cwd,
      operation: "publish context",
      args: ["remote"],
    });
    const hasRemote = Boolean(remotes.stdout.trim());
    const owner = hasRemote ? null : yield* github.getViewerLogin({ cwd: input.cwd });
    let owners: GitPublishContextResult["owners"] = [];
    if (owner) {
      const organizations = yield* github.execute({
        cwd: input.cwd,
        args: ["api", "user/orgs?per_page=100", "--paginate", "--slurp"],
      });
      const decoded = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Array(Schema.Array(Schema.Struct({ login: TrimmedNonEmptyString }))),
        ),
      )(organizations.stdout).pipe(
        Effect.mapError(
          (cause) =>
            new GitHubCliError({
              operation: "publish context",
              detail: "GitHub returned an invalid organization list.",
              cause,
            }),
        ),
      );
      owners = [
        { login: owner, kind: "user" },
        ...decoded.flat().map(({ login }) => ({ login, kind: "organization" as const })),
      ];
    }
    return {
      hasRemote,
      owner,
      owners,
      name: path.basename(root.stdout.trim()),
    } satisfies GitPublishContextResult;
  });
}

export function publishGitHubRepository(input: GitPublishRepositoryInput) {
  return Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHubCli;
    const repository = `${input.owner}/${input.name}`;
    const fail = (detail: string) =>
      Effect.fail(
        new GitCommandError({
          cwd: input.cwd,
          operation: "publish repository",
          command: "gh repo create",
          detail,
        }),
      );
    if (!isValidGitHubRepositoryNameWithOwner(repository))
      return yield* fail("Enter a valid GitHub owner and repository name.");
    const remotes = yield* git.execute({
      cwd: input.cwd,
      operation: "publish repository",
      args: ["remote"],
    });
    if (remotes.stdout.trim())
      return yield* fail("A remote is already configured. Use Push to publish commits to it.");
    const operation = yield* readGitOperation(input.cwd, git.execute);
    if (operation.kind || operation.conflicts.length)
      return yield* fail("Finish the current Git operation before publishing.");
    const head = yield* git.execute({
      cwd: input.cwd,
      operation: "publish repository",
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
    });
    if (head.code !== 0) return yield* fail("Create a commit before publishing to GitHub.");
    const branch = yield* git.execute({
      cwd: input.cwd,
      operation: "publish repository",
      args: ["symbolic-ref", "--short", "HEAD"],
    });
    const root = yield* git.execute({
      cwd: input.cwd,
      operation: "publish repository",
      args: ["rev-parse", "--show-toplevel"],
    });
    const url = `https://github.com/${repository}`;
    yield* github
      .execute({
        cwd: root.stdout.trim(),
        args: [
          "repo",
          "create",
          repository,
          `--${input.visibility}`,
          "--source",
          root.stdout.trim(),
          "--remote",
          "origin",
        ],
        timeoutMs: 120_000,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new GitHubCliError({
              operation: "publish repository",
              detail: `${error.detail} Repository creation may have completed; check ${url} and local remotes before retrying.`,
              ...(error.reason ? { reason: error.reason } : {}),
              cause: error,
            }),
        ),
      );
    return yield* git.pushCurrentBranch(input.cwd, branch.stdout.trim()).pipe(
      Effect.match({
        onSuccess: () => ({ status: "published", url }) satisfies GitPublishRepositoryResult,
        onFailure: (error) =>
          ({
            status: "pushFailed",
            url,
            error: `${error.message} The GitHub repository and origin were created. Retry with Push after resolving the error.`,
          }) satisfies GitPublishRepositoryResult,
      }),
    );
  });
}
