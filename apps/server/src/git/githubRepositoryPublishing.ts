import path from "node:path";
import { Effect } from "effect";
import {
  GitPublishContextInput,
  GitPublishContextResult,
  GitPublishRepositoryInput,
  GitPublishRepositoryResult,
} from "@glade/contracts/git/githubRepositoryPublishing";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/git/githubRepository";
import { GitCommandError, GitHubError } from "./Errors";
import { GitCore } from "./Services/GitCore";
import { GitHub } from "./Services/GitHub";
import { readGitOperation } from "./gitOperationState";

export function readGitPublishContext(input: GitPublishContextInput) {
  return Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHub;
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
    const viewer = hasRemote ? null : yield* github.getViewer();
    let owners: GitPublishContextResult["owners"] = [];
    if (viewer) {
      const organizations = yield* github.listViewerOrganizations();
      owners = [
        { ...viewer, kind: "user" },
        ...organizations.map((account) => ({ ...account, kind: "organization" as const })),
      ];
    }
    return {
      hasRemote,
      owner: viewer?.login ?? null,
      owners,
      name: path.basename(root.stdout.trim()),
    } satisfies GitPublishContextResult;
  });
}

export function publishGitHubRepository(input: GitPublishRepositoryInput) {
  return Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHub;
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
            new GitHubError({
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
