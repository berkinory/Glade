import { spawnSync } from "node:child_process";
import { Effect } from "effect";

import { GitHubError } from "../Errors.ts";
import { decodePullRequestSummaries } from "../github/pullRequestQueries.ts";
import { type GitHubShape, type GitHubPullRequestSummary } from "../Services/GitHub.ts";

const PULL_REQUEST_SUMMARY_JSON_FIELDS =
  "number,title,url,baseRefName,headRefName,state,mergedAt,isDraft,mergeable,additions,deletions,changedFiles,isCrossRepository,headRepository,headRepositoryOwner,updatedAt";

// Scenario fixtures are `gh --json` output; it shares field names with the GraphQL nodes the live
// layer decodes, so both go through the same normalization.
const decodePullRequestListJson = (stdout: string) =>
  Effect.try({
    try: () => decodePullRequestSummaries(stdout.trim() ? (JSON.parse(stdout) as unknown[]) : []),
    catch: () =>
      new GitHubError({ operation: "listPullRequests", detail: "Invalid PR list JSON fixture." }),
  });

const unmodeled = (name: string) =>
  Effect.die(new Error(`The fake GitHub service does not model ${name}.`));

export interface FakeGhScenario {
  prListSequence?: string[];
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    baseRefName: string;
    headRefName: string;
    state?: "open" | "closed" | "merged";
    isCrossRepository?: boolean;
    headRepositoryNameWithOwner?: string | null;
    headRepositoryOwnerLogin?: string | null;
  };
  repositoryCloneUrls?: Record<string, { url: string; sshUrl: string }>;
}

type FakePullRequest = NonNullable<FakeGhScenario["pullRequest"]>;

function ok(stdout: string) {
  return { stdout, stderr: "", code: 0, signal: null, timedOut: false };
}

function runGitSyncForFakeGh(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return;
  }
  throw new GitHubError({
    operation: "execute",
    detail: `Failed to simulate gh checkout with git ${args.join(" ")}: ${result.stderr?.trim() || "unknown error"}`,
  });
}

function isGitHubError(error: unknown): error is GitHubError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag?: unknown })._tag === "GitHubError"
  );
}

export function createFakeGitHub(scenario: FakeGhScenario = {}): {
  service: GitHubShape;
  ghCalls: string[];
} {
  const prListQueue = [...(scenario.prListSequence ?? [])];
  const ghCalls: string[] = [];

  const execute: GitHubShape["execute"] = (input) => {
    const args = [...input.args];
    ghCalls.push(args.join(" "));

    if (args[0] === "pr" && args[1] === "list") {
      return Effect.succeed(ok(`${prListQueue.shift() ?? "[]"}\n`));
    }

    if (args[0] === "pr" && args[1] === "create") {
      return Effect.succeed(ok("https://github.com/example-org/sample-repo/pull/101\n"));
    }

    if (args[0] === "pr" && args[1] === "view") {
      const pullRequest: FakePullRequest = scenario.pullRequest ?? {
        number: 101,
        title: "Pull request",
        url: "https://github.com/example-org/sample-repo/pull/101",
        baseRefName: "main",
        headRefName: "feature/pull-request",
        state: "open",
      };
      return Effect.succeed(
        ok(
          JSON.stringify({
            ...pullRequest,
            ...(pullRequest.headRepositoryNameWithOwner
              ? {
                  headRepository: {
                    nameWithOwner: pullRequest.headRepositoryNameWithOwner,
                  },
                }
              : {}),
            ...(pullRequest.headRepositoryOwnerLogin
              ? {
                  headRepositoryOwner: {
                    login: pullRequest.headRepositoryOwnerLogin,
                  },
                }
              : {}),
          }) + "\n",
        ),
      );
    }

    if (args[0] === "pr" && args[1] === "checkout") {
      return Effect.try({
        try: () => {
          const headBranch = scenario.pullRequest?.headRefName;
          if (headBranch) {
            const existingBranch = spawnSync(
              "git",
              ["show-ref", "--verify", "--quiet", `refs/heads/${headBranch}`],
              {
                cwd: input.cwd,
                encoding: "utf8",
              },
            );
            if (existingBranch.status === 0) {
              runGitSyncForFakeGh(input.cwd, ["checkout", headBranch]);
            } else {
              runGitSyncForFakeGh(input.cwd, ["checkout", "-b", headBranch]);
            }
          }
          return ok("");
        },
        catch: (error) =>
          isGitHubError(error)
            ? error
            : new GitHubError({
                operation: "execute",
                detail:
                  error instanceof Error
                    ? `Failed to simulate gh checkout: ${error.message}`
                    : "Failed to simulate gh checkout.",
              }),
      });
    }

    if (args[0] === "repo" && args[1] === "view") {
      const repository = args[2];
      if (typeof repository === "string" && args.includes("nameWithOwner,url,sshUrl")) {
        const cloneUrls = scenario.repositoryCloneUrls?.[repository];
        if (!cloneUrls) {
          return Effect.fail(
            new GitHubError({
              operation: "execute",
              detail: `Unexpected repository lookup: ${repository}`,
            }),
          );
        }
        return Effect.succeed(
          ok(
            JSON.stringify({
              nameWithOwner: repository,
              url: cloneUrls.url,
              sshUrl: cloneUrls.sshUrl,
            }) + "\n",
          ),
        );
      }
      return Effect.succeed(ok("main\n"));
    }

    return Effect.fail(
      new GitHubError({
        operation: "execute",
        detail: `Unexpected gh command: ${args.join(" ")}`,
      }),
    );
  };

  const listPullRequestsWithState = (
    input: { cwd: string; headSelector?: string; limit?: number },
    options: { state: "open" | "all"; defaultLimit: number },
  ) =>
    execute({
      cwd: input.cwd,
      args: [
        "pr",
        "list",
        ...(input.headSelector ? ["--head", input.headSelector] : []),
        "--state",
        options.state,
        "--limit",
        String(input.limit ?? options.defaultLimit),
        "--json",
        PULL_REQUEST_SUMMARY_JSON_FIELDS,
      ],
    }).pipe(Effect.flatMap((result) => decodePullRequestListJson(result.stdout)));

  return {
    service: {
      execute,
      getViewer: () => {
        ghCalls.push("api user --jq .login");
        return Effect.succeed({ login: "viewer", avatarUrl: null });
      },
      listOpenPullRequests: (input) =>
        listPullRequestsWithState(input, { state: "open", defaultLimit: 1 }),
      listPullRequests: (input) =>
        listPullRequestsWithState(input, { state: "all", defaultLimit: 20 }),
      createPullRequest: (input) =>
        execute({
          cwd: input.cwd,
          args: [
            "pr",
            "create",
            "--base",
            input.baseBranch,
            "--head",
            input.headSelector,
            "--title",
            input.title,
            "--body-file",
            input.bodyFile,
            ...(input.draft === true ? ["--draft"] : []),
          ],
        }).pipe(Effect.asVoid),
      getDefaultBranch: (input) =>
        execute({
          cwd: input.cwd,
          args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
        }).pipe(
          Effect.map((result) => {
            const value = result.stdout.trim();
            return value.length > 0 ? value : null;
          }),
        ),
      getPullRequest: (input) =>
        execute({
          cwd: input.cwd,
          args: ["pr", "view", input.reference, "--json", PULL_REQUEST_SUMMARY_JSON_FIELDS],
        }).pipe(Effect.map((result) => JSON.parse(result.stdout) as GitHubPullRequestSummary)),
      getRepositoryCloneUrls: (input) =>
        execute({
          cwd: input.cwd,
          args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
        }).pipe(Effect.map((result) => JSON.parse(result.stdout))),
      checkoutPullRequest: (input) =>
        execute({
          cwd: input.cwd,
          args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
        }).pipe(Effect.asVoid),
      getPullRequestReview: () => unmodeled("PR reviews"),
      listRepositoryPullRequests: () => unmodeled("PR search"),
      listViewerOrganizations: () => unmodeled("organizations"),
      resolveCommitAuthorAvatars: () => unmodeled("commit author avatars"),
      getPullRequestDetail: () => unmodeled("PR details"),
      getPullRequestDiff: () => unmodeled("PR diffs"),
      getCheckLog: () => unmodeled("check logs"),
      rerunFailedJobs: () => unmodeled("reruns"),
      mergePullRequest: (input) =>
        execute({
          cwd: input.cwd,
          args: ["pr", "merge", String(input.number), `--${input.method}`],
        }).pipe(Effect.asVoid),
      updatePullRequestBranch: (input) =>
        execute({ cwd: input.cwd, args: ["pr", "update-branch", String(input.number)] }).pipe(
          Effect.asVoid,
        ),
      markPullRequestReady: (input) =>
        execute({ cwd: input.cwd, args: ["pr", "ready", String(input.number)] }).pipe(
          Effect.asVoid,
        ),
    },
    ghCalls,
  };
}
